import {LinkUnfurls, MessageAttachment} from '@slack/types';

interface SharedLink {
  domain: string;
  url: string;
};

interface Unfurler {
  readonly LINK_RE: RegExp;
  getLinkUnfurls(links: SharedLink[]): LinkUnfurls;
};

