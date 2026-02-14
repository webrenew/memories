import React from "react"
import { source } from '@/lib/source';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from 'fumadocs-ui/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CopyMarkdownButton } from '@/components/CopyMarkdownButton';
import { MCPInstallButtons } from '@/components/MCPInstallButtons';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage 
      toc={page.data.toc}
      tableOfContent={{
        footer: <CopyMarkdownButton slug={slug} />,
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents, MCPInstallButtons }} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
