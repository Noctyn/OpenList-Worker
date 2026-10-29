import test from "node:test"
import assert from "node:assert/strict"
import { AliDocDriver, normalizeAliDocAddition } from "./driver"
import { AliDocClient } from "./util"

test("normalizeAliDocAddition trims fields", () => {
  const a = normalizeAliDocAddition({
    cookie: "  mock=cookie  ",
    root_folder_id: "  root123  ",
  })
  assert.equal(a.cookie, "mock=cookie")
  assert.equal(a.root_folder_id, "root123")
})

test("AliDocDriver instantiation without network", () => {
  const driver = new AliDocDriver({
    cookie: "mock=cookie",
    root_folder_id: "root123",
  })
  assert.ok(driver)
})

test("AliDocClient builds API headers and resolves base URL", () => {
  const c = new AliDocClient({
    cookie: "a=b; XSRF-TOKEN=test-token; portal_corp_id=corp123",
    site: "international",
  })
  assert.ok(c)
  assert.equal(c.apiBase, "https://docs.dingtalk.io")
})

test("AliDocClient resolves custom base URL", () => {
  const c = new AliDocClient({
    cookie: "a=b",
    custom_base_url: "https://mycorp.dingtalk.io/i/desktop",
  })
  assert.equal(c.apiBase, "https://mycorp.dingtalk.io")
})

test("normalizeAliDocAddition parses site and custom_base_url", () => {
  const a = normalizeAliDocAddition({
    cookie: " c ",
    root_folder_id: " r ",
    site: " international ",
    custom_base_url: " https://docs.dingtalk.io/ ",
  })
  assert.equal(a.site, "international")
  assert.equal(a.custom_base_url, "https://docs.dingtalk.io/")
})
