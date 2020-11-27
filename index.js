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
  const response = await axios.get(ARXIV_API_URL + arxivId);
  if (response.status != 200) {
    console.log(`Error calling arXiv API for ${request.url}`)
    return;
  }
  const result = await parseString(response.data);
  if (!result.feed.entry) {
    throw new Error('ArXiv entry not found');
  }
  var entry = result.feed.entry[0];
  console.log('Got arXiv data:', entry)
  return {
    id      : entry.id ?
      entry.id[0].split('/').pop() :
      '{No ID}',
    url     : entry.id ?
      entry.id[0] :
      '{No url}',
    title   : entry.title ?
      entry.title[0].trim().replace(/\n/g, ' ') :
      '{No title}',
    summary : entry.summary ?
      entry.summary[0].trim().replace(/\n/g, ' ') :
      '{No summary}',
    authors : entry.author ?
      entry.author.map(function (a) { return a.name[0]; }) :
    '{No authors}',
    categories : entry.category ? entry.category.map(c => c.$.term) : [],
    updated_time : Date.parse(entry.updated) / 1000,
  };
}

const formatArxivDataAsAttachment = function (arxivData) {
  return {
    author_name: arxivData.authors.join(', '),
    title      : '[' + arxivData.id + '] ' + arxivData.title,
    title_link : arxivData.url,
    text       : arxivData.summary,
    footer     : arxivData.categories.join(', '),
    footer_icon: 'https://arxiv.org/favicon.ico',
    ts         : arxivData.updated_time,
    color      : '#b31b1b',
  };
}

const verifySignature = function(req, signing_secret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const hmac = crypto.createHmac('sha256', signing_secret);
  const [version, hash] = signature.split('=');
  
  hmac.update(`${version}:${timestamp}:${req.rawBody}`);
  return hmac.digest('hex') === hash;
};

arxivBot = async function arxivBot(req, res) {
  console.log("Got request:", req.body);
  if (SIGNING_SECRET) {
    const result = verifySignature(req, SIGNING_SECRET);
    if (result.code) {
      console.warn(`checkSignature: ${result.msg}`)
      res.status(result.code).send(result.msg);
      return;
    }
  } else if (req.body.token !== VERIFICATION_TOKEN) {
    // Deprecated fallback if no signing secret is configured.
    console.log("got bad token", req.body.token);
    res.status(403).send('Invalid token');
    return;
  }
  
  if (req.body.type === 'url_verification') {
    console.log("got challenge", req.body.challenge);
    res.status(200).send(req.body.challenge);
    console.log("replied", req.body.challenge);
  } else if (req.body.type === 'event_callback' && req.body.event.type == 'link_shared') {
    console.log("got event", req.body.event);
    res.status(200).send('ok');
    
    const event = req.body.event;
    var unfurls = {};
    
    for (const link of event.links) {
      if (link.domain !== 'arxiv.org') {
	console.log('error: incorrect link.domain:', link.domain);
	continue;
      }
      const arxivData = await fetchArxivData(link.url.match(ARXIV_ID)[0]);
      unfurls[link.url] = formatArxivDataAsAttachment(arxivData);
      console.log('Formatted arXiv data:', unfurls[link.url]);
    }
    console.log('Posting unfurls:', {
      token: OAUTH_TOKEN,
      channel: event.channel,
      ts: event.message_ts,
      unfurls: unfurls
    });
    const post_result = await axios({
      method: 'POST',
      url: 'https://slack.com/api/chat.unfurl',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data: {
	token: OAUTH_TOKEN,
	channel: event.channel,
	ts: event.message_ts,
	unfurls: unfurls,

      }
    });
    const {status, headers, data} = post_result;
    console.log('post_result:', status, headers, data);
  } else {
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

