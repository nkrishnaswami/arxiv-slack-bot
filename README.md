# arxiv-slack-bot
## Changes
This has diverged a good bit from the original (Slack bot of Theseus :-)):
* Javascript to Typescript
* Node to bun
* Config file support
* Switched to Slack's Bolt framework
* Abstracted unfurlers a little to allow plugging in more at some point
* Support for socket mode
* Support for OAuth installation flows

Anyway, thanks to @rshin for making something I've gotten to tinker with and enjoy for a long time.

## Original

To use this code:

* Host this code somewhere. You might be able to use AWS Lambda or Google Cloud Functions.
* Create a new Slack app in your Slack team.
  * Obtain credentials as needed for `index.js`
  * Under Event Subscriptiptions:
    1. Enable Events and give the URL of where the app is hosted.
       If the token is initially unknown, disable the `req.body.token !== APP_TOKEN` check to have the Request URL verified.
    2. Add `arxiv.org` to App Unfurl Domains.
  * Under OAuth & Permissions:
    1. Add the `links:write` permission scope.
    2. Install the app with your account in your Slack team.

As the OAuth token is hardcoded, this app might not work in chats and channels which do not involve the user that installed the app.
