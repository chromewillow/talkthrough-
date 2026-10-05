import { describe, expect, it } from "vitest";
import { chatEndpoint, checkRelayTarget, ipv6Bytes, isPrivateAddress, readBodyLimited } from "@/lib/server/relay-guard";

const strict = { allowHttp: false, allowPrivate: false };

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::7f00:1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "ff02::1",
  ])("refuses %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "104.18.2.1", "2606:4700::6810:1", "::ffff:8.8.8.8", "2002:808:808::"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it("expands compressed IPv6 with an IPv4 tail", () => {
    expect(ipv6Bytes("::ffff:1.2.3.4")?.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
  });
});

describe("checkRelayTarget", () => {
  it("accepts a normal provider and builds its endpoint without string tricks", () => {
    const url = checkRelayTarget("https://openrouter.ai/api/v1/", "talkthrough.app", strict);
    expect(url).toBeInstanceOf(URL);
    expect(chatEndpoint(url as URL).toString()).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it.each([
    ["http://api.example.com/v1", "https"],
    ["https://api.example.com/v1#", "query or a fragment"],
    ["https://api.example.com/other?x=", "query or a fragment"],
    ["https://user:pw@api.example.com/v1", "credentials"],
    ["https://talkthrough.app/api/llm", "itself"],
    ["https://localhost/v1", "local"],
    ["https://metadata.google.internal/v1", "local"],
    ["https://[::ffff:127.0.0.1]/v1", "private"],
    ["https://169.254.169.254/latest", "private"],
  ])("refuses %s", (raw, reason) => {
    const result = checkRelayTarget(raw, "talkthrough.app", strict);
    expect(typeof result).toBe("string");
    expect(String(result)).toContain(reason);
  });

  it("lets development reach local mock servers", () => {
    expect(checkRelayTarget("http://localhost:4011/v1", null, { allowHttp: true, allowPrivate: true })).toBeInstanceOf(URL);
  });
});

describe("readBodyLimited", () => {
  it("stops reading past the limit", async () => {
    const big = new Request("https://x.test", { method: "POST", body: "x".repeat(5000) });
    expect(await readBodyLimited(big, 1000)).toBeNull();
    const small = new Request("https://x.test", { method: "POST", body: "hello" });
    expect(await readBodyLimited(small, 1000)).toBe("hello");
  });
});
