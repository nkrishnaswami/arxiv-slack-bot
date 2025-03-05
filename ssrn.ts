import type { SharedLink, Unfurler } from './unfurler';

import type { LinkUnfurls, MessageAttachment } from '@slack/types';
import {DOMParser} from 'linkedom';

const SSRN_LINK_RE = /(?:https?:\/\/)?(?:[a-z]+.)?ssrn\.com\/.*?abstract(?:Id|_id)=(\d+)/
const SSRN_ABSTRACT_URL = 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=';

interface ParsedSSRNEntry {
  url: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string;
  date: number;
  doi: string;
};

const fetchSSRNData = async (abstractID: string): Promise<Partial<ParsedSSRNEntry> | null> => {
  const response = await fetch(`${SSRN_ABSTRACT_URL}${abstractID}`);
  if (!response.ok) {
    console.error(`Error calling ssrn API for ${response.url}: ${await response.text()}`);
    return null;
  }
  const text = await response.text();

  const document = (new DOMParser).parseFromString(text, response.headers.get('content-type'));
  if (document.querySelector('error')) {
    console.error(`Error: ${text}`)
    return null;
  }
  const metas = document.querySelectorAll('meta');
  if (!metas) {
    console.error('No metadata')
    return null
  }
  const ret: Partial<ParsedSSRNEntry> = {authors: []}
  let date;
  ret.title = document.querySelector('main h1')?.textContent
  for (const meta of metas) {
    if (meta.getAttribute('name') === 'description') {
      ret.summary = meta.getAttribute('content').trim();
    } else if (meta.getAttribute('name') === 'citation_author') {
      ret.authors.push(meta.getAttribute('content').trim());
    } else if (meta.getAttribute('name') === 'citation_title') {
      ret.title = meta.getAttribute('content').trim();
    } else if (meta.getAttribute('name') === 'citation_online_date') {
      const onlineDate = new Date(meta.getAttribute('content'))
      if (!date || onlineDate > date) {
	date = onlineDate
      }
    } else if (meta.getAttribute('name') === 'citation_publication_date') {
      const pubDate = new Date(meta.getAttribute('content'))
      if (!date || pubDate > date) {
	date = pubDate
      }
    } else if (meta.getAttribute('name') === 'citation_doi') {
      ret.doi = meta.getAttribute('content').trim();
    } else if (meta.getAttribute('name') === 'citation_abstract_html_url') {
      ret.url = meta.getAttribute('content').trim();
    } else if (meta.getAttribute('name') === 'citation_keywords') {
      ret.categories = meta.getAttribute('content').trim();
    }
  }
  ret.date = date / 1000;

  const abstractParas = document.querySelectorAll('.abstract-text :not(h3)');
  const abstract_ = abstractParas.map((x) => x.textContent).join('\n\n');
  if (abstract_) {
    ret.summary = abstract_;
  }
  return ret;
}


const formatSSRNDataAsAttachment = (ssrnData: Partial<ParsedSSRNEntry>): MessageAttachment => {
  return {
    author_name: ssrnData.authors.join(', '),
    title: ssrnData.title,
    title_link: ssrnData.url,
    text: (ssrnData.summary ?? "") + (ssrnData.doi ? `  \nDOI: ${ssrnData.doi}` : ''),
    footer: ssrnData.categories,
    footer_icon: 'https://ssrn.com/favicon.ico',
    ts: `${ssrnData.date}`,
    color: '#b31b1b',
  };
}

export class SSRNUnfurler implements Unfurler {
  LINK_RE = SSRN_LINK_RE;

  getLinkUnfurls = async (links: SharedLink[]): Promise<LinkUnfurls> => {
    const unfurls: LinkUnfurls = {};
    for (const {url, abstractID} of links
      .map(({url}) => {return {url, match: url.match(SSRN_LINK_RE)}})
      .filter(({match}) => !!match)
      .map(({url, match}) => {return {url, abstractID: match[1]}})) {
	const ssrnData = await fetchSSRNData(abstractID);
	if (ssrnData) {
	  unfurls[url] = formatSSRNDataAsAttachment(ssrnData);
	}
    }
    return unfurls;
  }
}

export default SSRNUnfurler;
