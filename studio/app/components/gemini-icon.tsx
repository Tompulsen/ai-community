import { useId, type SVGProps } from "react";

export function GeminiIcon(props: SVGProps<SVGSVGElement>) {
  const gradient = `gemini-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" {...props}>
      <title>Gemini</title>
      <g transform="translate(3, 3)">
        <defs>
          <linearGradient
            id={gradient}
            x1="0%"
            x2="68.73%"
            y1="100%"
            y2="30.395%"
          >
            <stop offset="0%" stopColor="#1C7DFF" />
            <stop offset="52.021%" stopColor="#1C69FF" />
            <stop offset="100%" stopColor="#F0DCD6" />
          </linearGradient>
        </defs>
        <path
          d="M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12"
          fill={`url(#${gradient})`}
          fillRule="nonzero"
        />
      </g>
    </svg>
  );
}
