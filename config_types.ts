import type { LogLevel } from "@slack/bolt";

type ServerConfig = {
  // The "Signing secret" under "Basic Information", "App Credentials".
  signing_secret: string;
  // The port on which to listen for requests and/or for installation management.
  port?: number;
  // You can change this if you don't want verbose logs
  log_level?: LogLevel;
}

type WebSocketsCredentials = {
  // To enable socket mode, enter the app token you created for that purpose from
  // "Basic Information", "App-Level Tokens"
  app_token: string;
}

type BasicCredentials = {
  // For a single workspace installation, enter the "OAuth Access
  // Token" under OAuth & Permissions; single workspace installation
  oauth_token: string;
}

type OAuthFlowCredentials = {
  // ALTERNATIVELY (they are mutually incompatible with oauth_token)
  // if you are using the OAuth installation flow (for distribution
  // or org-wide install, eg), set these.  They are under "Basic
  // Information", "App Credentials".
  client_id: string;
  client_secret: string;
  state_secret: string;
}

export type Config = ServerConfig &
  (BasicCredentials | OAuthFlowCredentials) &
  Partial<WebSocketsCredentials>;

export function isOAuthFlow(config: Config): config is Config & OAuthFlowCredentials {
  return (
    'client_id' in config &&
    'client_secret' in config &&
    'state_secret' in config
  );
}

export function isBasicAuth(config: Config): config is Config & BasicCredentials {
  return 'oauth_token' in config;
}

