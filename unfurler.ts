import type { LinkUnfurls, MessageAttachment } from '@slack/types';

export interface SharedLink {
  domain: string;
  url: string;
};

export interface Unfurler {
  readonly LINK_RE: RegExp;
  getLinkUnfurls(links: SharedLink[]): Promise<LinkUnfurls>;
};

