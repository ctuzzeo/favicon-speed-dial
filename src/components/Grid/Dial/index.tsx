import { observer } from "mobx-react-lite";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { dialColors } from "#lib/dialColors";
import { contextMenu } from "#stores/useContextMenu";
import { settings } from "#stores/useSettings";

import "./styles.css";

interface DialProps {
  id: string;
  title?: string;
  name: string[];
  type: "bookmark" | "folder";
  url?: string;
}

interface NameProps {
  name: string[];
}

interface SmallProps {
  align: string;
  children: React.ReactNode;
}

interface DomainProps {
  title?: boolean;
  padding?: boolean;
  children: React.ReactNode;
}

interface TitleProps {
  title?: string;
  name: string[];
  type: "bookmark" | "folder";
}

export const Dial = observer(function Dial(props: DialProps) {
  const backgroundColor = settings.dialColors[props.id]
    ? settings.dialColors[props.id]
    : dialColors(props.name);
  const backgroundImage = settings.dialImages[props.id];

  const nameFallback = (
    <div>
      <Name
        {...{
          name: props.name,
        }}
      />
    </div>
  );

  const isTransparent = props.type === "bookmark" 
    ? (settings.dialTransparent[props.id] ?? true)
    : false;

  return (
    <a
      href={props.type === "bookmark" ? props.url : `#${props.id}`}
      data-id={props.id}
      data-title={props.title}
      data-type={props.type}
      data-thumbnail={backgroundImage ? "" : null}
      rel={props.type === "bookmark" ? "noreferrer" : undefined}
      className="Link"
      target={
        props.type === "bookmark" && settings.newTab ? "_blank" : undefined
      }
      onContextMenu={contextMenu.openContextMenu}
    >
      <div
        className="Box"
        style={{
          backgroundColor: isTransparent ? "transparent" : backgroundColor,
          boxShadow: isTransparent ? "none" : undefined,
          backgroundImage: backgroundImage
            ? `url("${backgroundImage}")`
            : undefined,
          backgroundPosition: "center",
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          textShadow:
            props.type !== "folder" ? "2px 1px 0 rgb(33,33,33,0.7)" : "none",
        }}
      >
        {!settings.dialImages[props.id] &&
          (props.type === "bookmark" ? (
            <Favicon
              url={props.url}
              fallback={nameFallback}
            />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="folder"
            >
              <path d="M0 0h24v24H0V0z" fill="none" />
              <path d="M9.17 6l2 2H20v10H4V6h5.17M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          ))}
      </div>
      <Title {...{ title: props.title, name: props.name, type: props.type }} />
    </a>
  );
});

function getFaviconUrls(domain: string, fullUrl: string) {
  const list: { url: string; type: string }[] = [
    {
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
      type: "google",
    },
  ];
  // Chromium-only extension favicon URL; fails on Firefox and in web demo builds.
  if (typeof __CHROME__ !== "undefined" && __CHROME__) {
    list.push({
      url: `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=128`,
      type: "native",
    });
  }
  return list;
}

function pickBestFavicon(
  results: { url: string; width: number; type: string }[],
): string {
  if (results.length === 0) return "";
  const typeRank = (t: string) => (t === "native" ? 1 : 0);
  const sorted = [...results].sort((a, b) => {
    if (b.width !== a.width) return b.width - a.width;
    return typeRank(b.type) - typeRank(a.type);
  });
  return sorted[0]?.url || "";
}

function parseBookmarkUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const Favicon = observer(function Favicon({
  url,
  fallback,
}: {
  url?: string;
  fallback: React.ReactNode;
}) {
  const [bestUrl, setBestUrl] = useState<string | null>(null);
  const parsed = url ? parseBookmarkUrl(url) : null;
  const hostname = parsed?.hostname ?? "";
  const manualFaviconOverride = hostname
    ? settings.manualFavicons[hostname]
    : undefined;

  useEffect(() => {
    if (!url) {
      setBestUrl("");
      return;
    }

    const parsedUrl = parseBookmarkUrl(url);
    if (!parsedUrl) {
      setBestUrl("");
      return;
    }

    const host = parsedUrl.hostname;
    const manual = settings.manualFavicons[host];
    if (manual) {
      setBestUrl(manual);
      return;
    }

    setBestUrl(null);

    let isMounted = true;
    const domain = parsedUrl.hostname;
    const candidates = getFaviconUrls(domain, url);

    let loadedCount = 0;
    const results: { url: string; width: number; type: string }[] = [];

    const checkDone = () => {
      if (!isMounted) return;
      if (loadedCount === candidates.length) {
        setBestUrl(pickBestFavicon(results));
      }
    };

    candidates.forEach((c) => {
      const img = new Image();
      img.src = c.url;
      img.onload = () => {
        if (isMounted) {
          results.push({ url: c.url, width: img.naturalWidth, type: c.type });
          loadedCount++;
          checkDone();
        }
      };
      img.onerror = () => {
        if (isMounted) {
          loadedCount++;
          checkDone();
        }
      };
    });

    return () => {
      isMounted = false;
    };
  }, [url, hostname, manualFaviconOverride]);

  if (bestUrl === null) return null;
  if (bestUrl === "") return <>{fallback}</>;

  return (
    <img
      src={bestUrl}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
      }}
    />
  );
});

function Name(props: NameProps) {
  return props.name.length === 1 ? (
    <Domain {...{ title: true }}>{props.name.join(".")}</Domain>
  ) : props.name.length === 3 && props.name[0].length < props.name[1].length ? (
    <>
      <Small align="left" key={props.name[0]}>
        {props.name[0]}
      </Small>
      <Domain key={props.name[1]}>{props.name[1]}</Domain>
      <Small align="right" key={props.name[2]}>
        {props.name[2]}
      </Small>
    </>
  ) : props.name.length === 2 ? (
    <>
      <Domain padding={true} key={props.name[0]}>
        {props.name[0]}
      </Domain>
      <Small align="right" key={props.name[1]}>
        {props.name[1]}
      </Small>
    </>
  ) : props.name[0].length > props.name[1].length ||
    props.name[0].length === props.name[1].length ? (
    <>
      <Domain padding={true}>{props.name[0]}</Domain>
      <Small align="right">{props.name.slice(1).join(".")}</Small>
    </>
  ) : (
    <>
      <Small align="left">{props.name[0]}</Small>
      <Domain>{props.name[1]}</Domain>
      <Small align="right">{props.name.slice(2).join(".")}</Small>
    </>
  );
}

function Small(props: SmallProps) {
  return (
    <div
      className="Small"
      style={
        {
          "--name-align": props.align,
        } as React.CSSProperties
      }
    >
      <div>{props.children}</div>
    </div>
  );
}

function Domain(props: DomainProps) {
  const [scale, setScale] = useState<number | null>(null);
  const domainRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const domainElement = domainRef.current;
    if (!domainElement) return;
    const boxElement = domainElement.closest(".Box") as HTMLElement;
    if (!boxElement) return;

    const calculateScale = () => {
      const domainWidth = domainElement.offsetWidth;
      const domainHeight = domainElement.offsetHeight;
      const boxWidth = boxElement.offsetWidth;
      const boxHeight = boxElement.offsetHeight;

      const maxWidth = boxWidth * 0.92;
      const maxHeight = boxHeight * 0.92;

      let newScale = null;
      if (domainHeight > maxHeight) {
        newScale = maxHeight / domainHeight;
      } else if (domainWidth > maxWidth) {
        newScale = maxWidth / domainWidth;
      }

      setScale(newScale);
    };

    const resizeObserver = new ResizeObserver(() => {
      calculateScale();
    });

    resizeObserver.observe(domainElement);
    resizeObserver.observe(boxElement);
    calculateScale();

    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  return (
    <div
      ref={domainRef}
      className="Domain"
      style={
        {
          "--name-white-space": props.title ? "initial" : "nowrap",
          "--name-padding": props.title
            ? "0"
            : props.padding
              ? "1em 0 0"
              : "0 0",
          "--name-transform": scale ? `scale(${scale})` : "initial",
        } as React.CSSProperties
      }
    >
      <div>{props.children}</div>
    </div>
  );
}

const Title = observer(function Title(props: TitleProps) {
  return (
    <div className="Title">
      <div 
        className={`title ${props.type}`}
        style={{
          "--title-opacity": settings.titleOpacity,
          "--title-size": settings.titleSize,
        } as React.CSSProperties}
      >
        <div>
          {props.title || props.name.join(".")}
        </div>
      </div>
    </div>
  );
});
