import config from "./config";
import {isBasicAuth, isOAuthFlow} from "./config_types";
import type {Config} from "./config_types";
import ArxivUnfurler from "./arxiv";

import process from "process";
import {App} from "@slack/bolt";
import type {AppOptions} from "@slack/bolt";
import {LogLevel} from "@slack/bolt";
import {FileInstallationStore} from "@slack/oauth";
import type {ChatUnfurlArguments, LinkUnfurls} from "@slack/web-api";

// Basic config
const PORT = config.port || 8081;
const SIGNING_SECRET = config.signing_secret;
const LOG_LEVEL = config.log_level || LogLevel.DEBUG;


const APP_TOKEN = process.env.APP_TOKEN ||
  ('app_token' in config) ? config.app_token : undefined;

const OAUTH_TOKEN = ((config: Config): string | undefined => {
  if (process.env.OAUTH_TOKEN) {
    return process.env.OAUTH_TOKEN;
  }
  if (isBasicAuth(config)) {
    return config.oauth_token;
  }
  return undefined;
})(config);

const {CLIENT_ID, CLIENT_SECRET, STATE_SECRET} = ((config: Config) => {
  const ret = {
      CLIENT_ID: process.env.CLIENT_ID,
      CLIENT_SECRET: process.env.CLIENT_SECRET,
      STATE_SECRET: process.env.STATE_SECRET,
  }
  if (isOAuthFlow(config)) {
    ret.CLIENT_ID ||= config.client_id;
    ret.CLIENT_SECRET ||= config.client_secret;
    ret.STATE_SECRET ||= config.state_secret;
  }
  return ret;
})(config);

if (!OAUTH_TOKEN && !(CLIENT_ID && CLIENT_SECRET && STATE_SECRET)) {
  throw new Error("Invalid config: Missing authentication config.");
}

const appConfig: AppOptions = {
  port: PORT,  // for install links
  signingSecret: SIGNING_SECRET,
  logLevel: LOG_LEVEL,
};

// If APP_TOKEN is present, we should use socket mode.
if (APP_TOKEN) {
  appConfig.socketMode = true;  // for event subscriptions
  appConfig.appToken = APP_TOKEN;  // for socket mode
}

// if CLIENT_ID is present, we should use the OAuth installation flow.
if (CLIENT_ID) {
  appConfig.clientId = CLIENT_ID;
  appConfig.clientSecret = CLIENT_SECRET;
  appConfig.stateSecret = STATE_SECRET;
  appConfig.scopes = ['links:read', 'links:write'];
  appConfig.installationStore = new FileInstallationStore();
} else {
  // Otherwise we should use the hard-coded token.
  appConfig.token = OAUTH_TOKEN;
}

console.log('Starting app', appConfig)

const app = new App(appConfig);

const UNFURLERS = [
  new ArxivUnfurler(),
];

app.use(async ({next}) => {await next();})

app.event("link_shared", async ({event, client}) => {
  const allUnfurls: LinkUnfurls = {}
  for (const unfurler of UNFURLERS) {
    const unfurls = await unfurler.getLinkUnfurls(event.links);
    if (unfurls) {
      for (const url of Object.getOwnPropertyNames(unfurls)) {
	allUnfurls[url] = unfurls[url]
      }
    }
  }
  const req: ChatUnfurlArguments = {
    unfurls: allUnfurls,
    source: event.source!,
    unfurl_id: event.unfurl_id!,
    channel: event.channel,
    ts: event.message_ts,
  };
  const resp = await client.chat.unfurl(req);
  if (!resp.ok) {
    console.error('Unable to unfurl URLs', {req, resp})
  }
});

await app.start();
app.logger.info("arXiv-unfurler-bot is running")
