import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collect, render } from "../../scripts/thirdPartyLicenses";

const nm = (p: string) => resolve(__dirname, "../../node_modules", p);

describe("тексты лицензий библиотек в сборке", () => {
  it("пакет по пути модуля: имя, версия, лицензия и полный текст; сам проект и дубли не входят", () => {
    const pkgs = collect(
      [
        nm("react/index.js"),
        nm("react/cjs/react.production.js"),
        `\0${nm("@fontsource-variable/geist/index.css")}?inline`,
        resolve(__dirname, "../main.tsx"),
      ],
      "dzenanalytics",
    );
    expect(pkgs.map((p) => p.name)).toEqual(["@fontsource-variable/geist", "react"]);
    const react = pkgs.find((p) => p.name === "react")!;
    expect(react.license).toBe("MIT");
    expect(react.text).toMatch(/Permission is hereby granted/);
    expect(pkgs[0].license).toBe("OFL-1.1");
    expect(pkgs[0].text).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it("пакет без своего файла лицензии — тексты вложенных частей (victory-vendor везёт d3)", () => {
    const [v] = collect([nm("victory-vendor/es/d3-scale.js")], "dzenanalytics");
    expect(v.name).toBe("victory-vendor");
    expect(v.text).toMatch(/--- lib-vendor\/d3-scale\/LICENSE ---/);
  });

  it("файл: заголовок, число пакетов, запись на каждый пакет", () => {
    const text = render(collect([nm("react/index.js"), nm("clsx/dist/clsx.mjs")], "x"), "DzenAnalytics 9.9.9");
    expect(text.startsWith("DzenAnalytics 9.9.9 — third-party software")).toBe(true);
    expect(text).toMatch(/Packages: 2/);
    expect(text).toMatch(/^clsx \d/m);
    expect(text).toMatch(/^react \d/m);
  });
});
