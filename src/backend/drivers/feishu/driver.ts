// Feishu (飞书 / LarkSuite) Storage Driver
// Ported from: OpenList/drivers/feishu
import {
  calcFileType,
  FileItem,
  StorageDriver,
} from "../../internal/driver/base"
import { sortFileItems } from "../../internal/driver/sort"
import { FeishuAddition, FeishuNode } from "./types"
import { FeishuClient, feishuUserAgent, parseSize } from "./util"

export function normalizeFeishuAddition(a: unknown, defaultBaseURL = "https://my.feishu.cn"): FeishuAddition {
  const obj = a && typeof a === "object" ? (a as Record<string, unknown>) : {}
  return {
    cookie: typeof obj.cookie === "string" ? obj.cookie.trim() : "",
    base_url: typeof obj.base_url === "string" ? obj.base_url.trim() : defaultBaseURL,
    root_folder_id: typeof obj.root_folder_id === "string" ? obj.root_folder_id.trim() : "",
    order_by: typeof obj.order_by === "string" ? obj.order_by.trim() : undefined,
    order_direction: typeof obj.order_direction === "string" ? obj.order_direction.trim() : undefined,
  }
}

export function feishuNodeToFileItem(node: FeishuNode): FileItem {
  const isDir = node.type === 0 || node.type === 4
  const size = isDir ? 0 : parseSize(node.extra?.size)
  let name = (node.name || "").trim()
  if (!name) {
    name = node.obj_token || node.node_token || node.token || "unknown"
  }
  const id = node.token || node.node_token || node.obj_token || ""

  return {
    name,
    size,
    is_dir: isDir,
    modified: node.edit_time
      ? new Date(node.edit_time * 1000).toISOString()
      : new Date().toISOString(),
    created: node.create_time
      ? new Date(node.create_time * 1000).toISOString()
      : undefined,
    sign: id,
    type: calcFileType(name, isDir),
    thumb: node.thumbnail || undefined,
  }
}

export class FeishuDriver implements StorageDriver {
  protected addition: FeishuAddition
  protected client: FeishuClient
  // Path -> FeishuNode cache for fast path-to-token resolution
  private nodeCache = new Map<string, FeishuNode>()

  constructor(addition: unknown, defaultBaseURL = "https://my.feishu.cn") {
    this.addition = normalizeFeishuAddition(addition, defaultBaseURL)
    this.client = new FeishuClient(this.addition, defaultBaseURL)
  }

  async init(): Promise<void> {
    if (!this.addition.cookie) {
      throw new Error("Feishu cookie is empty")
    }
    await this.client.checkCookie()
  }

  private cleanPath(p: string): string {
    const s = "/" + (p || "").split("/").filter(Boolean).join("/")
    return s === "/" ? "/" : s
  }

  private joinPath(parent: string, name: string): string {
    return parent === "/" ? `/${name}` : `${parent}/${name}`
  }

  private async resolveNode(path: string): Promise<FeishuNode | null> {
    const clean = this.cleanPath(path)
    if (clean === "/") {
      return {
        token: this.addition.root_folder_id || "",
        node_token: this.addition.root_folder_id || "",
        obj_token: "",
        name: "root",
        type: 0,
      }
    }

    const cached = this.nodeCache.get(clean)
    if (cached) return cached

    const parts = clean.split("/").filter(Boolean)
    let currentPath = "/"
    let currentNode: FeishuNode = {
      token: this.addition.root_folder_id || "",
      node_token: this.addition.root_folder_id || "",
      obj_token: "",
      name: "root",
      type: 0,
    }

    for (let i = 0; i < parts.length; i++) {
      const partName = parts[i]
      currentPath = this.joinPath(currentPath, partName)

      const subCached = this.nodeCache.get(currentPath)
      if (subCached) {
        currentNode = subCached
        continue
      }

      const children = await this.client.listAllChildren(currentNode.token)
      for (const child of children) {
        const childName = (child.name || "").trim() || child.obj_token || child.token
        const childPath = this.joinPath(
          currentPath.slice(0, currentPath.lastIndexOf("/")),
          childName,
        )
        this.nodeCache.set(childPath, child)
      }

      const match = children.find(
        (c) => (c.name || "").trim() === partName || c.token === partName,
      )
      if (!match) {
        return null
      }
      currentNode = match
      this.nodeCache.set(currentPath, currentNode)
    }

    return currentNode
  }

  async list(virtualPath: string, physicalPath: string): Promise<FileItem[]> {
    const clean = this.cleanPath(physicalPath)
    const node = await this.resolveNode(clean)
    if (!node) {
      return []
    }

    const children = await this.client.listAllChildren(node.token)
    const items: FileItem[] = []

    for (const child of children) {
      if (!child.token && !child.node_token && !child.obj_token) {
        continue
      }
      const childName = (child.name || "").trim() || child.obj_token || child.token
      this.nodeCache.set(this.joinPath(clean, childName), child)
      items.push(feishuNodeToFileItem(child))
    }

    return sortFileItems(
      items,
      this.addition.order_by,
      this.addition.order_direction,
    )
  }

  async get(virtualPath: string, physicalPath: string): Promise<FileItem> {
    const clean = this.cleanPath(physicalPath)
    if (clean === "/") {
      return {
        name: "root",
        size: 0,
        is_dir: true,
        modified: new Date().toISOString(),
        sign: this.addition.root_folder_id || "",
        type: 1,
      }
    }

    const node = await this.resolveNode(clean)
    if (!node) {
      throw new Error(`File or folder not found: ${clean}`)
    }

    const item = feishuNodeToFileItem(node)
    if (item.is_dir) {
      return item
    }

    let rawUrl = ""
    // Cloud documents (docx, sheet, mindnote, etc.) use node.url
    if (node.type !== 12 && node.url) {
      rawUrl = node.url
    } else {
      const fileToken = node.obj_token || node.token || node.node_token || ""
      rawUrl = `${this.client.apiBase}/space/api/box/stream/download/all/${fileToken}/`
    }

    return {
      ...item,
      raw_url: rawUrl,
      raw_url_headers: {
        Cookie: this.client.getCookie(),
        Referer: `${this.client.apiBase}/drive/home/`,
        "User-Agent": feishuUserAgent,
      },
    }
  }

  async mkdir(virtualPath: string, physicalPath: string): Promise<void> {
    const clean = this.cleanPath(physicalPath)
    const lastSlash = clean.lastIndexOf("/")
    const parentPath = lastSlash <= 0 ? "/" : clean.slice(0, lastSlash)
    const dirName = clean.slice(lastSlash + 1)

    const parentNode = await this.resolveNode(parentPath)
    if (!parentNode) {
      throw new Error(`Parent directory not found: ${parentPath}`)
    }

    const created = await this.client.createFolder(parentNode.token, dirName)
    this.nodeCache.set(clean, created)
  }

  async rename(
    virtualPath: string,
    physicalPath: string,
    newName: string,
  ): Promise<void> {
    const clean = this.cleanPath(physicalPath)
    const node = await this.resolveNode(clean)
    if (!node) {
      throw new Error(`Node not found: ${clean}`)
    }

    const isDir = node.type === 0 || node.type === 4
    if (isDir) {
      await this.client.renameFolder(node.token, newName)
    } else {
      const fileToken = node.obj_token || node.token || node.node_token || ""
      await this.client.renameFile(fileToken, newName)
    }

    this.nodeCache.delete(clean)
    node.name = newName
    const lastSlash = clean.lastIndexOf("/")
    const parentPath = lastSlash <= 0 ? "/" : clean.slice(0, lastSlash)
    this.nodeCache.set(this.joinPath(parentPath, newName), node)
  }

  async move(
    srcDir: string,
    dstDir: string,
    names: string[],
    srcPhys: string,
    dstPhys: string,
  ): Promise<void> {
    const dstNode = await this.resolveNode(this.cleanPath(dstPhys))
    if (!dstNode) {
      throw new Error(`Destination directory not found: ${dstPhys}`)
    }

    for (const name of names) {
      const srcPath = this.joinPath(this.cleanPath(srcPhys), name)
      const srcNode = await this.resolveNode(srcPath)
      if (!srcNode) {
        throw new Error(`Source file not found: ${srcPath}`)
      }
      await this.client.moveObj(srcNode.token, dstNode.token)
      this.nodeCache.delete(srcPath)
      this.nodeCache.set(this.joinPath(this.cleanPath(dstPhys), name), srcNode)
    }
  }

  async copy(
    srcDir: string,
    dstDir: string,
    names: string[],
    srcPhys: string,
    dstPhys: string,
  ): Promise<void> {
    const dstNode = await this.resolveNode(this.cleanPath(dstPhys))
    if (!dstNode) {
      throw new Error(`Destination directory not found: ${dstPhys}`)
    }

    for (const name of names) {
      const srcPath = this.joinPath(this.cleanPath(srcPhys), name)
      const srcNode = await this.resolveNode(srcPath)
      if (!srcNode) {
        throw new Error(`Source file not found: ${srcPath}`)
      }

      if (srcNode.type === 0 || srcNode.type === 4) {
        await this.mkdir("", this.joinPath(dstPhys, name))
        const children = await this.client.listAllChildren(srcNode.token)
        const childNames = children.map((c) => (c.name || "").trim() || c.token).filter(Boolean)
        if (childNames.length > 0) {
          await this.copy(
            srcPath,
            this.joinPath(dstPhys, name),
            childNames,
            srcPath,
            this.joinPath(dstPhys, name),
          )
        }
      } else {
        const item = await this.get("", srcPath)
        if (!item.raw_url) {
          throw new Error(`Cannot obtain download URL for ${name}`)
        }
        const res = await fetch(item.raw_url, {
          headers: item.raw_url_headers || {},
        })
        if (!res.ok) {
          throw new Error(`Failed to download ${name}: HTTP ${res.status}`)
        }
        const arrayBuf = await res.arrayBuffer()
        await this.client.upload(name, Buffer.from(arrayBuf), dstNode.token)
      }
    }
  }

  async remove(
    virtualPath: string,
    physicalPath: string,
    names: string[],
  ): Promise<void> {
    const clean = this.cleanPath(physicalPath)
    const tokens: string[] = []

    for (const name of names) {
      const path = this.joinPath(clean, name)
      const node = await this.resolveNode(path)
      if (node?.token) {
        tokens.push(node.token)
      }
      this.nodeCache.delete(path)
    }

    if (tokens.length > 0) {
      await this.client.removeObj(tokens)
    }
  }

  async put(
    virtualPath: string,
    physicalPath: string,
    content: Buffer,
  ): Promise<void> {
    const clean = this.cleanPath(physicalPath)
    const lastSlash = clean.lastIndexOf("/")
    const parentPath = lastSlash <= 0 ? "/" : clean.slice(0, lastSlash)
    const fileName = clean.slice(lastSlash + 1)

    const parentNode = await this.resolveNode(parentPath)
    if (!parentNode) {
      throw new Error(`Parent directory not found: ${parentPath}`)
    }

    await this.client.upload(fileName, content, parentNode.token)
    this.nodeCache.delete(clean)
  }
}

export class LarkSuiteDriver extends FeishuDriver {
  constructor(addition: unknown) {
    super(addition, "https://www.larksuite.com")
  }
}
