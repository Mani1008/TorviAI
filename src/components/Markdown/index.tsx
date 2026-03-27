import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { CopyButton } from "./copy-button";

interface MarkdownProps {
  content: string;
}

export function Markdown({ content }: MarkdownProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={{
          pre({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLPreElement>>) {
            const codeContent =
              typeof children === "string"
                ? children
                : (children as React.ReactElement<{ children?: string }>)?.props?.children ?? "";
            return (
              <div className="relative group">
                <CopyButton text={String(codeContent)} />
                <pre {...props}>{children}</pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
