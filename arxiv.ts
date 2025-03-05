import type {SharedLink, Unfurler} from './unfurler';

import type {LinkUnfurls, MessageAttachment} from '@slack/types';
import {Parser} from 'xml2js';
const parser = new Parser({trim: true});
const parseString = parser.parseStringPromise;

const ARXIV_API_URL = 'http://export.arxiv.org/api/query';
const ARXIV_ID   = /\d{4}\.\d{4,5}/;
const ARXIV_ID_ERROR_PREFIX = "http://arxiv.org/api/errors#"

interface ArxivAuthor {
  name: string[];
  "arxiv:affiliation"?: string[];
};

interface ArxivCategory {
  $: {
    "scheme": string;
    "term": string;
  };
};


interface ArxivEntry {
  title: string[]
  id: string[];  // URL of abstract, viz. https://arxiv.org/abs/{ARXIV_ID}
  published: string[];
  updated: string[];

  summary: string[];
  author: ArxivAuthor[];
  category: ArxivCategory[];
  "arxiv:journal_ref"?: string[];
  "arxiv:doi"?: string[];
};

interface ArxivFeed {
  title: string[]
  id: string[];
  link: string[];
  updated: string[];
  "opensearch:totalResults": number[];
  "opensearch:startIndex": number[];
  "openSearch:itemsPerPage": number[];
  entry: ArxivEntry[];
};

interface ArxivResponse {
  feed: ArxivFeed;
};

interface ParsedArxivEntry {
  id: string;
  url: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  updated_time: number;
  journal_ref?: string;
  doi?: string;
};

interface ParsedArxivError {
  error: string;
};

const parseEntry = (entry: ArxivEntry): ParsedArxivEntry | ParsedArxivError => {
  const ret: ParsedArxivEntry = {
    id: entry.id ? entry.id[0].split('/').pop() ?? '{No ID}' : '{No ID}',
    url: entry.id ? entry.id[0] : '{No url}',
    title: entry.title ? entry.title[0].trim().replace(/\n/g, ' ') : '{No title}',
    summary: entry.summary ? entry.summary[0].trim().replace(/\n/g, ' ') : '{No summary}',
    authors: entry.author ? entry.author.map((a) => a['arxiv:affiliation']? `${a.name[0]} (${a['arxiv:affiliation'][0]})` : a.name[0])
      : ['{No authors}'],
    categories: entry.category ? entry.category.map(c => c.$.term) : [],
    updated_time: Date.parse(entry.updated[0]) / 1000,
  }
  if (ret.id && ret.id.startsWith(ARXIV_ID_ERROR_PREFIX)) {
    return {
      error: entry.summary[0]
    }
  }
  if (entry["arxiv:journal_ref"]) {
    ret.journal_ref = entry["arxiv:journal_ref"][0]
  }
  if (entry["arxiv:doi"]) {
    ret.doi = entry["arxiv:doi"][0]
  }
  return ret;
}

const fetchArxivData = async (urls: string[]): Promise<{[key: string]: ParsedArxivEntry}> => {
  const arxivIDs: string[] = [];
  const arxivIDToURL: {[key: string]: string} = {};
  for (let idx = 0; idx < arxivIDs.length; ++idx) {
    const arxivID = urls[idx].match(ARXIV_ID)[0];
    arxivIDs.push(arxivID)
    arxivIDToURL[arxivID] = urls[idx];
  }
  console.log(`Fetching arxiv data for [${arxivIDs.join(", ")}]`);

  const response = await fetch(`${ARXIV_API_URL}?id_list=${arxivIDs.map((x)=>`arXiv:${x}`).join(",")}&max_results=${arxivIDs.length}`);
  if (!response.ok) {
    console.log(`Error calling arXiv API for ${response.url}: ${await response.text}`);
    return {};
  }
  const result = await parseString(await response.text);
  if (!result.feed.entry) {
    console.log('ArXiv entries not found');
    return {};
  }
  const parsedEntries = result.feed.entry.map(parseEntry);
  if (parsedEntries.length === 1 && parsedEntries[0].error) {
    console.log(`Error calling arXiv API for ${response.url}: ${parsedEntries[0].error}`);
    return {};
  }
  const ret: {[key: string]: ParsedArxivEntry} = {}
  for (const parsedEntry of parsedEntries) {
    ret[arxivIDToURL[parsedEntry.id]] = parsedEntry;
  }
  return ret;
}

const formatArxivDataAsAttachment = (arxivData: ParsedArxivEntry): MessageAttachment => {
  return {
    author_name: arxivData.authors.join(', '),
    title: '[' + arxivData.id + '] ' + arxivData.title,
    title_link: arxivData.url,
    text: arxivData.summary,
    footer: arxivData.categories.join(', '),
    footer_icon: 'https://arxiv.org/favicon.ico',
    ts: `${arxivData.updated_time}`,
    color: '#b31b1b',
  };
}

export class ArxivUnfurler implements Unfurler {
  LINK_RE = /(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:.pdf)?/g

  getLinkUnfurls = async (links: SharedLink[]): Promise<LinkUnfurls> => {
    const unfurls: LinkUnfurls = {};
    const arXivURLs = links.filter(({domain, url}) => domain === "arxiv.org").map(({domain, url}) => url)
    const arxivData = await fetchArxivData(arXivURLs);
    for (const url of Object.getOwnPropertyNames(arxivData)) {
      unfurls[url] = formatArxivDataAsAttachment(arxivData[url]);
    }
    return unfurls;
  }
}

export default ArxivUnfurler;
