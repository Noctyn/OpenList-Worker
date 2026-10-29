import { bindings, defineConfig } from "cf/config";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example, .env.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

/**
 * This migration needs manual work. Resolve every TODO in this file, then remove the error below.
 */
/**
 * TODO(@cloudflare): cf migrate: Automatic dependency installation was disabled. Install `cf@latest` before using the generated configuration.
 */
/**
 * TODO(@cloudflare): cf migrate: Automatic dependency installation was disabled. Install `wrangler@latest` with your package manager before using the generated configuration.
 */

export default defineConfig({
	worker: {
		name: "openlist-tsworkers",
		compatibilityDate: "2026-08-04",
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "src/backend/worker.ts",
		workersDev: true,
		previewUrls: false,
		domains: [
			"opls.erii.cc.cd",
		],
		assets: {
			runWorkerFirst: [
				"/",
				"/index.html",
			],
		},
		env: {
			ENVIRONMENT: bindings.text("production"),
			DB_FORMAT: bindings.text("map"),
			DB_DRIVER: bindings.text("auto"),
			DB_CIPHER: bindings.text("none"),
			CACHE_ENABLED: bindings.text("true"),
			CACHE_DRIVER: bindings.text("db"),
			CACHE_FILE_TREE: bindings.text("true"),
			CACHE_DOWNLOAD_LINK: bindings.text("false"),
			CACHE_TTL: bindings.text("0"),
			CACHE_LINK_TTL: bindings.text("5"),
			CACHE_EXCLUDE_DRIVERS: bindings.text("virtual,alias,url_tree,strm,chunk"),
			SINGLEFLIGHT: bindings.text("auto"),
			KV: bindings.kv(),
			ASSETS: bindings.assets(),
		},
	},
});
