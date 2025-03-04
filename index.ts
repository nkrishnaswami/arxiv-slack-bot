import config from "./config";
import ArxivUnfurler from "./arxiv";

import process from "process";
import {App, LogLevel} from "@slack/bolt";
import { FileInstallationStore } from "@slack/oauth";
import type {ChatUnfurlArguments} from "@slack/web-api";

// "Signing secret" under Basic Information
const SIGNING_SECRET = process.env.SIGNING_SECRET || config.signing_secret;
// "OAuth Access Token" under OAuth & Permissions
const OAUTH_TOKEN = process.env.OAUTH_TOKEN || config.oauth_token;
const PORT = process.env.PORT || config.port || 8081;
// OAuth for distribution
const CLIENT_ID = process.env.CLIENT_ID || config.client_id;
const CLIENT_SECRET = process.env.CLIENT_SECRET || config.client_secret;
const STATE_SECRET = process.env.STATE_SECRET || config.state_secret;


const app = new App({
  token: OAUTH_TOKEN,
  port: PORT,
  signingSecret: SIGNING_SECRET,
  logLevel: LogLevel.DEBUG,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  stateSecret: STATE_SECRET,
  scopes: ['links:read', 'links:write'],
  installationStore: new FileInstallationStore(),
})

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
    source: event.source,
    unfurl_id: event.unfurl_id,
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
