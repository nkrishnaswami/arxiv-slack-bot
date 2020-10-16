var config = require('./config.js');

var http = require('http');
var Express = require('express');
var BodyParser = require('body-parser');

// Partially derived from https://github.com/joebullard/slack-arxivbot.

// "Verification token" under Basic Information
// "OAuth Access Token" under OAuth & Permissions
const APP_TOKEN = process.env.APP_TOKEN || config.app_token;
const OAUTH_TOKEN = process.env.OAUTH_TOKEN || config.oauth_token;
const PORT = process.env.PORT || config.port || 8081;
var Promise = require('bluebird');
var axios = require('axios');
var parseString = Promise.promisify(require('xml2js').parseString);

const ARXIV_ID   = /\d{4}\.\d{4,5}/;
const ARXIV_LINK = /(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:.pdf)?/g;
const ARXIV_API_URL = 'http://export.arxiv.org/api/query?search_query=id:';

const fetchArxiv = function (arxivId, callback) {
  return axios.get(ARXIV_API_URL + arxivId).then(parseApiResponse);
};

const parseApiResponse = function (response) {
    if (response.status != 200) {
	console.log(`Error calling arXiv API for ${request.url}`)
	return;
    }
  return parseString(response.data).then(result => {
    if (!result.feed.entry) {
      throw new Error('ArXiv entry not found');
    }
    var entry = result.feed.entry[0];
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
  });
}

const formatArxivAsAttachment = function (arxivData) {
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

arxivBot = function arxivBot(req, res) {
  console.log("Got request:", req.body);
  if (req.body.token !== APP_TOKEN) {
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
    
    Promise.map(event.links, link => {
      if (link.domain !== 'arxiv.org') {
        throw new Error('incorrect link.domain: ' + link.domain);
      }
      return fetchArxiv(link.url.match(ARXIV_ID)[0]).then(arxiv => {
        unfurls[link.url] = formatArxivAsAttachment(arxiv);
      });
    }).then(() => {
      return rp.post({
        url: 'https://slack.com/api/chat.unfurl',
        form: {
          token: OAUTH_TOKEN,
          channel: event.channel,
          ts: event.message_ts,
          unfurls: JSON.stringify(unfurls)
        },
      });
    }).catch(err => {
      console.log('error:', err);
    });
  } else {
    res.status(400).send('Unknown request');
  }
}


// Install the routes.
var router = Express.Router();
router.all('/arxivbot', arxivBot);

// Start the server.
var app = Express();
app.use(BodyParser.urlencoded({extended: true}));
app.use(BodyParser.json());
app.use('/', router);
http.createServer(app).listen(PORT);

