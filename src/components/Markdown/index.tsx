import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CopyButton } from "./copy-button";

interface MarkdownProps {
  content: string;
}

/** Only these link protocols are rendered as real anchors. Everything else
 *  (file:, smb:, javascript:, data:, custom handlers) is rendered as plain
 *  text to prevent OS-level exploitation via AI-generated Markdown links. */
const SAFE_LINK_PROTOCOLS = ["https:", "http:", "mailto:"];

function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return true;
  try {
    return SAFE_LINK_PROTOCOLS.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function Markdown({ content }: MarkdownProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
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
          // AI-09: Strip unsafe link protocols — only http/https/mailto/#anchors allowed
          a({ href, children, ...props }) {
            if (!isSafeHref(href)) {
              return <span {...props}>{children}</span>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
