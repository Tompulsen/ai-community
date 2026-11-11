"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { UI_LOGO_SRC, UI_LOGO_SRC_SET } from "./ui-logo";

export default function OctopusIcon(props: {
  width?: number;
  height?: number;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  const size = props.width ?? 43;

  if (hasError) {
    return (
      <div
        className={props.className}
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: "white",
          fontSize: size * 0.4,
          fontWeight: 700,
          ...(props.className ? {} : { display: "flex" }),
        }}
      >
        🐙
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <img
        src={UI_LOGO_SRC}
        srcSet={UI_LOGO_SRC_SET}
        alt="logo"
        loading="eager"
        decoding="sync"
        {...{ fetchpriority: "high" }}
        width={size}
        height={size}
        className={props.className}
        style={{
          borderRadius: 8,
          ...(props.className ? {} : { display: "block" }),
        }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}
