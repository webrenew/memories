import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const { GET } = createFromSource(source, {
  buildIndex: (page) => ({
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    id: page.url,
    structuredData: page.data.structuredData ?? {
      headings: [],
      contents: [
        {
          heading: page.data.title,
          content: page.data.description ?? '',
        },
      ],
    },
  }),
});
