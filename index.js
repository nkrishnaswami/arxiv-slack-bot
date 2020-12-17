const config = require('./config.js');

const http = require('http');
const Express = require('express');
const BodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios');
const util = require('util');
const parseString = util.promisify(require('xml2js').parseString);

// Partially derived from https://github.com/joebullard/slack-arxivbot.

// "Signing secret" under Basic Information
const SIGNING_SECRET = process.env.SIGNING_SECRET || config.signing_secret;
// "Verification token" under Basic Information
const VERIFICATION_TOKEN = process.env.VERIFICATION_TOKEN || config.verification_token;
// "OAuth Access Token" under OAuth & Permissions
const OAUTH_TOKEN = process.env.OAUTH_TOKEN || config.oauth_token;
const PORT = process.env.PORT || config.port || 8081;

const ARXIV_ID   = /\d{4}\.\d{4,5}/;
const ARXIV_LINK = /(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:.pdf)?/g;
const ARXIV_API_URL = 'http://export.arxiv.org/api/query?search_query=id:';

const fetchArxivData = async function (arxivId, callback) {
  console.log(`Fetching arxiv data for ${arxivId}`);
  const response = await axios.get(ARXIV_API_URL + arxivId);
  if (response.status != 200) {
    console.log(`Error calling arXiv API for ${request.url}`);
    return;
  }
  const result = await parseString(response.data);
  if (!result.feed.entry) {
    throw new Error('ArXiv entry not found');
  }
  var entry = result.feed.entry[0];
  return {
    id: entry.id ?
      entry.id[0].split('/').pop() :
      '{No ID}',
    url: entry.id ?
      entry.id[0] :
      '{No url}',
    title: entry.title ?
      entry.title[0].trim().replace(/\n/g, ' ') :
      '{No title}',
    summary: entry.summary ?
      entry.summary[0].trim().replace(/\n/g, ' ') :
      '{No summary}',
    authors: entry.author ?
      entry.author.map(function (a) { return a.name[0]; }) :
    '{No authors}',
    categories: entry.category ? entry.category.map(c => c.$.term) : [],
    updated_time: Date.parse(entry.updated) / 1000,
  };
}

const formatArxivDataAsAttachment = function (arxivData) {
  return {
    author_name: arxivData.authors.join(', '),
    title: '[' + arxivData.id + '] ' + arxivData.title,
    title_link: arxivData.url,
    text: arxivData.summary,
    footer: arxivData.categories.join(', '),
    footer_icon: 'https://arxiv.org/favicon.ico',
    ts: arxivData.updated_time,
    color: '#b31b1b',
  };
}

const getLinkUnfurls = async function(links) {
  var unfurls = {};
  
  for (const link of links) {
    if (link.domain !== 'arxiv.org') {
      console.log('error: incorrect link.domain:', link.domain);
      continue;
    }
    const arxivData = await fetchArxivData(link.url.match(ARXIV_ID)[0]);
    unfurls[link.url] = formatArxivDataAsAttachment(arxivData);
  }

  return unfurls;
}

const handleEventRequest = async function(req, res) {
  console.log("got event", req.body.event);
  switch (req.body.event.type) {
  case 'link_shared':
    res.status(200).send('ok');
    const event = req.body.event;
    const unfurl_data = {
      channel: event.channel,
      ts: event.message_ts,
      unfurls: await getLinkUnfurls(event.links)
    };
    console.log('Posting unfurls:', unfurl_data);

    const post_result = await axios({
      method: 'POST',
      url: 'https://slack.com/api/chat.unfurl',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'authorization': `Bearer ${OAUTH_TOKEN}`,
      },
      data: unfurl_data,
    });
    const {status, headers, data} = post_result;
    console.log('post_result:', status, headers, data);
    break;
  default:
    console.warn(`Unexpected event type '${req.body.event.type}'`);
    res.status(400).send('Unknown request');
  }
}

const verifySignature = function(req, signing_secret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const hmac = crypto.createHmac('sha256', signing_secret);
  const [version, hash] = signature.split('=');
  
  hmac.update(`${version}:${timestamp}:${req.rawBody}`);
  return hmac.digest('hex') === hash;
};

const verifyRequest = function(req) {
  if (SIGNING_SECRET) {
    if (!verifySignature(req, SIGNING_SECRET)) {
      return {msg: 'unable to verify request signature', code: 403};
    }
    return {msg: 'successfully verified request signature', code: 200};
  }
  if (VERIFICATION_TOKEN) {
    // Deprecated fallback if no signing secret is configured.
    console.warn('No signing secret specified; falling back to token verification.');
    if (req.body.token != VERIFICATION_TOKEN) {
      return {msg: 'received invalid token', code: 403};
    }
    return {msg: 'successfully verified token', code: 200};
  }
  return {msg: 'No verification requested', code: 200};
}

const arxivBot = async function(req, res) {
  console.log("Got request:", req.body);
  const {msg, code} = verifyRequest(req);
    console.log(`Verification result: status ${code}: ${msg}`);
  if (code != 200) {
    res.status(code).send(msg);
    return;
  }
  switch (req.body.type) {
  case 'url_verification':
    console.log("got challenge", req.body.challenge);
    res.status(200).send(req.body.challenge);
    console.log("replied", req.body.challenge);
    break;
  case 'event_callback':
    await handleEventRequest(req, res);
    break;
  default:
    console.warn(`Unexpected request type '${req.body.type}'`);
    res.status(400).send('Unknown request');
  }
}


// Install the routes.
var router = Express.Router();
router.all('/arxivbot', arxivBot);

// Start the server.
var app = Express();
const saveRawBody = function (req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}
app.use(BodyParser.urlencoded({verify: saveRawBody, extended: true }));
app.use(BodyParser.json({ verify: saveRawBody }));
app.use('/', router);
http.createServer(app).listen(PORT);

