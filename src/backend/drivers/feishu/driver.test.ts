import test from "node:test"
import assert from "node:assert/strict"
import { FeishuDriver, LarkSuiteDriver, feishuNodeToFileItem, normalizeFeishuAddition } from "./driver"
import { adler32, cleanBaseURL, getCsrfToken, FeishuClient } from "./util"

test("normalizeFeishuAddition trims fields and sets default base URL", () => {
  const feishu = normalizeFeishuAddition({
    cookie: "  mock=cookie  ",
    root_folder_id: "  folder123  ",
  })
  assert.equal(feishu.cookie, "mock=cookie")
  assert.equal(feishu.root_folder_id, "folder123")
  assert.equal(feishu.base_url, "https://my.feishu.cn")

  const lark = normalizeFeishuAddition({
    cookie: "  mock=cookie  ",
  }, "https://www.larksuite.com")
  assert.equal(lark.base_url, "https://www.larksuite.com")
})

test("cleanBaseURL resolves custom tenant domains", () => {
  assert.equal(cleanBaseURL("mycorp.larksuite.com"), "https://mycorp.larksuite.com")
  assert.equal(cleanBaseURL("https://mycorp.feishu.cn/drive/home/"), "https://mycorp.feishu.cn")
  assert.equal(cleanBaseURL("", "https://my.feishu.cn"), "https://my.feishu.cn")
})

test("getCsrfToken parses csrf tokens correctly", () => {
  assert.equal(getCsrfToken("a=1; _csrf_token=token123; b=2"), "token123")
  assert.equal(getCsrfToken("a=1; swp_csrf_token=swp456; b=2"), "swp456")
  assert.equal(getCsrfToken("a=1; csrf_token=csrf789; b=2"), "csrf789")
  assert.equal(getCsrfToken("a=1; b=2"), "")
})

test("adler32 calculation matches standard specification", () => {
  const buf = Buffer.from("Wikipedia")
  assert.equal(adler32(buf), "300286872")
})

test("feishuNodeToFileItem converts files and folders correctly", () => {
  const folder = feishuNodeToFileItem({
    token: "fld1",
    name: "Documents",
    type: 0,
    edit_time: 1700000000,
  })
  assert.equal(folder.name, "Documents")
  assert.equal(folder.is_dir, true)
  assert.equal(folder.type, 1)

  const file = feishuNodeToFileItem({
    token: "box1",
    name: "test.pdf",
    type: 12,
    extra: { size: "1024" },
    edit_time: 1700000000,
  })
  assert.equal(file.name, "test.pdf")
  assert.equal(file.is_dir, false)
  assert.equal(file.size, 1024)
  assert.equal(file.type, 0) // other file
})

test("FeishuDriver and LarkSuiteDriver instantiate without error", () => {
  const feishu = new FeishuDriver({ cookie: "test" })
  assert.ok(feishu)

  const lark = new LarkSuiteDriver({ cookie: "test" })
  assert.ok(lark)
})
