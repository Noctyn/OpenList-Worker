// Feishu (飞书 / LarkSuite) driver types
// Ported from: OpenList/drivers/feishu

export interface FeishuAddition {
  /** 根目录 Token（留空表示我的空间根目录） */
  root_folder_id?: string
  /** 站点域名：飞书默认 https://my.feishu.cn；LarkSuite 用户请填写租户域名如 https://xxxx.larksuite.com，支持直接填入首页 URL */
  base_url?: string
  /** 网页端 Cookie（从浏览器开发者工具复制） */
  cookie: string
  /** 自定义排序字段 */
  order_by?: string
  /** 自定义排序方向 */
  order_direction?: string
}

export interface FeishuBaseResp {
  code: number
  msg?: string
  message?: string
}

export interface FeishuNode {
  token: string
  node_token?: string
  obj_token?: string
  name: string
  type: number // 0 or 4: folder, 12: file
  node_type?: number
  owner_id?: string
  edit_uid?: string
  create_time?: number
  edit_time?: number
  url?: string
  thumbnail?: string
  extra?: {
    size?: string
    subtype?: string
  }
}

export interface FeishuListData {
  has_more: boolean
  last_label: string
  node_list?: string[]
  entities?: {
    nodes?: Record<string, FeishuNode>
    users?: Record<string, { id?: string; name?: string }>
  }
}

export interface FeishuListResp extends FeishuBaseResp {
  data?: FeishuListData
}

export interface FeishuCreateFolderResp extends FeishuBaseResp {
  data?: {
    entities?: {
      nodes?: Record<string, FeishuNode>
    }
    node_list?: string[]
  }
}

export interface FeishuRemoveResp extends FeishuBaseResp {
  data?: {
    task_id?: string
  }
}

export interface FeishuTaskStatusResp extends FeishuBaseResp {
  data?: {
    is_fail?: boolean
    is_finish?: boolean
  }
}

export interface FeishuUploadPrepareResp extends FeishuBaseResp {
  data?: {
    upload_id: string
    block_size: number
  }
}

export interface FeishuUploadBlock {
  hash: string
  seq: number
  size: number
  checksum: string
  is_uploaded: boolean
}

export interface FeishuUploadBlockNeed {
  seq: number
  checksum: string
}

export interface FeishuUploadBlocksResp extends FeishuBaseResp {
  data?: {
    needed_upload_blocks: FeishuUploadBlockNeed[]
  }
}

export interface FeishuUploadFinishResp extends FeishuBaseResp {
  data?: {
    file_token?: string
  }
}
