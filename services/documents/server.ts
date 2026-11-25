// SPDX-License-Identifier: AGPL-3.0-only
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	writeFile,
	rename,
	rm,
	stat,
	statfs,
} from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import {
	documentPlan,
	documentJobRequest,
	documentName,
} from "../../shared/studio/document-workspace.ts";

const root = path.resolve(process.env.DOCUMENT_STORAGE_ROOT || "./data");
const engine = process.env.DOCUMENT_ENGINE_ENTRY;
const secret = process.env.DOCUMENT_SERVICE_SECRET || "";
if (!engine || secret.length < 32)
	throw new Error("Document engine and service secret are required");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const active = new Map<string, AbortController>();
let occupied = false;
let receiving = false;
let stopping = false;
const engineReady = new Promise<{ docx: boolean; xlsx: boolean }>(resolve => {
  execFile(process.execPath, [engine!, 'health'], { windowsHide: true, timeout: 10000, maxBuffer: 16384 }, (error, stdout) => {
    try {
      const info = JSON.parse(stdout);
      resolve({ docx: !error && info.words === true && info.evaluation === false, xlsx: !error && info.cells === true && info.evaluation === false });
    } catch { resolve({ docx: false, xlsx: false }); }
  });
});
async function capabilities() {
  const { docx, xlsx } = await engineReady;
  return { enabled: docx || xlsx, docx, xlsx, activeJobs: occupied ? 1 : 0, reason: docx ? undefined : '文档引擎暂未就绪，请稍后重试。' };
}
const cancelled = new Set<string>();
const unsavedJobs = new Map<string, any>();
const terminal = new Set(["ready", "failed", "cancelled"]);
const mime = {
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const errorText: Record<string, string> = {
	OLD_VALUE_MISMATCH: "原文件内容已变化，请重新选择文件版本后修改。",
	FORMULA_UNSUPPORTED: "包含暂不支持的公式，请改用支持的公式后重试。",
	FORMULA_CACHE_UNVERIFIED: "公式计算未通过校验，未发布文件。",
	ACTIVE_CONTENT_UNSUPPORTED: "暂不支持含宏、嵌入对象或外部数据源的文件。",
	PROTECTED_OR_REVISION_DOCUMENT_UNSUPPORTED:
		"请先移除文档保护或确认修订，再上传文件。",
	PARAGRAPH_FEATURE_UNSUPPORTED: "目标段落含复杂格式，暂不支持此处的局部修改。",
	MERGED_CELL_TARGET_UNSUPPORTED: "请修改合并单元格左上角的单元格。",
	FORMAT_MISMATCH: "文件内容与扩展名不一致，请上传有效的 DOCX / XLSX。",
};
class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}
function check(
	condition: unknown,
	status: number,
	message: string,
): asserts condition {
	if (!condition) throw new HttpError(status, message);
}
async function jsonFile(file: string) {
	return JSON.parse(await readFile(file, "utf8"));
}
async function save(file: string, data: unknown) {
	const tmp = file + "." + randomUUID() + ".tmp";
	await writeFile(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
	try {
		for (let attempt = 0; ; attempt++) {
			try { await rename(tmp, file); break; }
			catch (error) {
				// Windows briefly locks the destination while another request reads it.
				if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 3) throw error;
				await new Promise(resolve => setTimeout(resolve, 20 * 3 ** attempt));
			}
		}
	} finally { await rm(tmp, { force: true }).catch(() => {}); }
}
function send(res: http.ServerResponse, status: number, data: unknown) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff",
	});
	res.end(JSON.stringify(data));
}
async function body(req: http.IncomingMessage, limit: number) {
	check(!receiving, 429, '文档上传繁忙，请稍后重试。');
	receiving = true;
	try {
	check(
		Number(req.headers["content-length"] || 0) <= limit,
		413,
		"文件或计划超过大小限制",
	);
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		check(size <= limit, 413, "文件或计划超过大小限制");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
	} finally { receiving = false; }
}
function publicJob(job: any) {
	const { plan, requestHash, sourcePath, ...result } = job;
	return result;
}
async function versions(home: string, id: string) {
	check(uuid.test(id), 400, "文件标识无效");
	return (await readdir(path.join(home, "assets", id)).catch(() => []))
		.filter((v) => /^[1-9]\d*$/.test(v))
		.map(Number)
		.sort((a, b) => b - a);
}
async function asset(home: string, id: string, version: number) {
	check(
		uuid.test(id) && Number.isSafeInteger(version) && version > 0,
		400,
		"文件版本无效",
	);
	try {
		return await jsonFile(
			path.join(home, "assets", id, String(version), "metadata.json"),
		);
	} catch {
		throw new HttpError(404, "找不到此文件或版本");
	}
}
async function jobFile(home: string, id: string) {
	check(uuid.test(id), 400, "任务标识无效");
	try {
		const job = (
			unsavedJobs.get(home + id) ||
			(await jsonFile(path.join(home, "jobs", id + ".json")))
		);
		return cancelled.has(home + id) && job.status === 'ready'
			? { ...job, status: 'cancelled', plan: undefined, assetId: null, version: null, canRecover: false, error: '文件已删除或任务已取消。' } : job;
	} catch {
		throw new HttpError(404, "找不到此文档任务");
	}
}
async function admission(home: string) {
	check(
		!occupied,
		429,
		"文档服务正在处理其他文件，请稍后重试制作；不会再次调用模型。",
	);
	occupied = true;
	try {
		const space = await statfs(root);
		check(
			space.bavail * space.bsize > 1024 ** 3,
			507,
			"文档存储空间不足，请稍后重试。",
		);
		const ids = (await readdir(path.join(home, "assets"))).filter((id) =>
			uuid.test(id),
		);
		let bytes = 0,
			count = 0;
		for (const id of ids)
			for (const v of await versions(home, id)) {
				bytes += (await asset(home, id, v)).size;
				count++;
			}
		check(
			count < 500 && bytes < 500 * 1024 * 1024,
			413,
			"当前账号的文档存储已达上限，请联系管理员。",
		);
	} catch (error) {
		occupied = false;
		throw error;
	}
}
async function executeEngine(
	dir: string,
	request: unknown,
	signal: AbortSignal,
) {
	const input = path.join(dir, "request.json"),
		output = path.join(dir, "response.json");
	await writeFile(input, JSON.stringify(request), { flag: "wx", mode: 0o600 });
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--max-old-space-size=384", engine!, input, output],
			{
				windowsHide: true,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "",
			timedOut = false;
		const stop = () => {
			if (!child.pid) return;
			if (process.platform === "win32")
				spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
					windowsHide: true,
					stdio: "ignore",
				});
			else {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, 90000);
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) stop();
		child.stdout.on("data", (chunk) => {
			if (stdout.length < 12000) stdout += chunk.toString();
		});
		child.stderr.resume();
		child.once("error", reject);
		child.once("close", (code) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
			stop();
			if (signal.aborted) reject(new HttpError(409, "文档处理已取消"));
			else if (timedOut)
				reject(new HttpError(504, "文档处理超时，可重试制作文件。"));
			else if (code !== 0) {
				let reason = "";
				try {
					reason = JSON.parse(stdout.trim().split("\n").at(-1) || "{}").code;
				} catch {}
				reject(
					new HttpError(
						422,
						errorText[reason] || "文件未通过处理与校验，请简化文件内容后重试。",
					),
				);
			} else resolve();
		});
	});
	const result = await jsonFile(output);
	check(
		result.file === "valid" && result.evaluation === false && result.structure,
		422,
		"文档校验未完成",
	);
	return result;
}
async function runJob(home: string, job: any, controller: AbortController) {
	const file = path.join(home, "jobs", job.id + ".json");
	const stage = path.join(home, "staging", job.id);
	active.set(home + job.id, controller);
	if (cancelled.has(home + job.id)) controller.abort();
	try {
		controller.signal.throwIfAborted();
		await mkdir(stage, { recursive: true, mode: 0o700 });
		job.status = "editing";
		job.updatedAt = new Date().toISOString();
		await save(file, job);
		let id = randomUUID(),
			version = 1,
			name = job.fileName,
			source: string | undefined;
		if (job.plan?.kind === "edit") {
			id = job.plan.sourceArtifactId;
			const previous = await asset(home, id, job.plan.baseVersion);
			check(
				(await versions(home, id))[0] === job.plan.baseVersion,
				409,
				"文件已有新版本，请选择最新版本后修改。",
			);
			version = job.plan.baseVersion + 1;
			name = previous.fileName;
			source = path.join(
				home,
				"assets",
				id,
				String(previous.version),
				"file." + previous.format,
			);
		}
		const destination = path.join(stage, "file." + job.format);
		const result = await executeEngine(
			stage,
			job.sourcePath
				? {
						action: "inspect",
						format: job.format,
						inputPath: job.sourcePath,
						outputPath: destination,
				  }
				: {
						action: "execute",
						format: job.format,
						plan: job.plan,
						inputPath: source,
						outputPath: destination,
				  },
			controller.signal,
		);
		controller.signal.throwIfAborted();
		if (job.sourcePath) await rename(job.sourcePath, destination);
		const size = (await stat(destination)).size;
		check(size <= 20 * 1024 * 1024, 413, "生成的文件超过 20 MiB");
		const metadata = {
			id,
			version,
			fileName: name,
			format: job.format,
			size,
			createdAt: new Date().toISOString(),
			hasPreview: true,
			sessionId: job.sessionId,
			jobId: job.id,
		};
		await writeFile(
			path.join(stage, "metadata.json"),
			JSON.stringify(metadata),
			{ mode: 0o600 },
		);
		await writeFile(
			path.join(stage, "structure.json"),
			JSON.stringify(result.structure),
			{ mode: 0o600 },
		);
		await writeFile(
			path.join(stage, "changes.json"),
			JSON.stringify(result.changes || []),
			{ mode: 0o600 },
		);
		await mkdir(path.join(home, "assets", id), {
			recursive: true,
			mode: 0o700,
		});
		controller.signal.throwIfAborted();
		await rename(stage, path.join(home, "assets", id, String(version)));
		Object.assign(job, {
			status: "ready",
			assetId: id,
			version,
			size,
			fileName: name,
			error: null,
			canRecover: false,
		});
	} catch (error) {
		if (!(error instanceof HttpError) && !controller.signal.aborted)
			console.error('Document processing failed', job.id, (error as NodeJS.ErrnoException)?.code || (error as Error)?.name, (error as NodeJS.ErrnoException)?.syscall, path.basename((error as NodeJS.ErrnoException & { path?: string })?.path || ''));
		Object.assign(job, {
			status: controller.signal.aborted ? "cancelled" : "failed",
			error:
				error instanceof HttpError
					? error.message
					: "文档处理未完成，可重试制作文件。",
			canRecover: !!job.plan,
		});
	} finally {
		job.updatedAt = new Date().toISOString();
		try {
			await save(file, job);
			unsavedJobs.delete(home + job.id);
		} catch {
			unsavedJobs.set(home + job.id, { ...job });
			console.error("Document status persistence failed", job.id);
		}
		await rm(stage, { recursive: true, force: true }).catch(() => {});
		if (job.sourcePath)
			await rm(job.sourcePath, { force: true }).catch(() => {});
		active.delete(home + job.id);
		occupied = false;
	}
}
await mkdir(root, { recursive: true, mode: 0o700 });
// Recover published output after an interrupted metadata write; never replay a model.
for (const owner of (await readdir(root)).filter((v) => /^user-\d+$/.test(v))) {
	const home = path.join(root, owner);
	for (const id of await readdir(path.join(home, "cancelled")).catch(() => []))
		if (uuid.test(id)) cancelled.add(home + id);
	for (const file of (
		await readdir(path.join(home, "jobs")).catch(() => [])
	).filter((v) => uuid.test(v.slice(0, -5)) && v.endsWith(".json"))) {
		const job = await jsonFile(path.join(home, "jobs", file));
		if (terminal.has(job.status)) continue;
		let published: any;
		for (const id of (
			await readdir(path.join(home, "assets")).catch(() => [])
		).filter((v) => uuid.test(v)))
			for (const v of await versions(home, id)) {
				const candidate = await asset(home, id, v);
				if (candidate.jobId === job.id) published = candidate;
			}
		if (published)
			Object.assign(job, {
				status: "ready",
				assetId: published.id,
				version: published.version,
				size: published.size,
				fileName: published.fileName,
				error: null,
			});
		else
			Object.assign(job, {
				status: "failed",
				error: "服务重启中断了文件处理，可重试制作。",
				canRecover: !!job.plan,
			});
		await save(path.join(home, "jobs", file), job);
	}
	await rm(path.join(home, "staging"), { recursive: true, force: true });
	await rm(path.join(home, "uploads"), { recursive: true, force: true });
}
export const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url || "/", "http://documents");
		check(!stopping || req.method === 'GET' || req.method === 'DELETE', 503, '文档服务正在更新，请稍后继续制作。');
		if (url.pathname === "/health" && req.method === "GET") {
			const status = await capabilities();
			return send(res, status.enabled ? 200 : 503, status);
		}
		const token = Buffer.from(String(req.headers.authorization || "")),
			expected = Buffer.from("Bearer " + secret);
		check(
			token.length === expected.length && timingSafeEqual(token, expected),
			401,
			"未授权",
		);
		const owner = String(req.headers["x-document-owner"] || "");
		check(/^user-[1-9]\d{0,14}$/.test(owner), 401, "账号无效");
		const home = path.join(root, owner);
		for (const folder of ["assets", "jobs", "uploads", "staging", "cancelled"])
			await mkdir(path.join(home, folder), { recursive: true, mode: 0o700 });
		const parts = url.pathname.split("/").filter(Boolean);
		if (req.method === "GET" && parts.join("/") === "capabilities")
			return send(res, 200, await capabilities());
		if (req.method === 'GET' && parts.join('/') === 'jobs') {
			const jobs = [];
			for (const name of await readdir(path.join(home, 'jobs'))) {
				if (!uuid.test(name.replace(/\.json$/, ''))) continue;
				const item = await jobFile(home, name.slice(0, -5)).catch(() => null);
				if (item && (!url.searchParams.get('sessionId') || item.sessionId === url.searchParams.get('sessionId'))) jobs.push(publicJob(item));
			}
			return send(res, 200, { jobs: jobs.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) });
		}
		if (req.method === 'DELETE' && parts[0] === 'assets' && parts.length === 2) {
			check(uuid.test(parts[1]), 400, '文件标识无效');
			check(!occupied, 409, '文档正在处理，请完成或取消后再删除文件。');
			occupied = true;
			try {
				const id = parts[1], latest = (await versions(home, id))[0];
				check(latest, 404, '文件不存在或已删除。');
				const related = [];
				for (const name of await readdir(path.join(home, 'jobs'))) {
					if (!uuid.test(name.replace(/\.json$/, ''))) continue;
					const job = await jobFile(home, name.slice(0, -5)).catch(() => null);
					if (job?.assetId === id || job?.plan?.sourceArtifactId === id) {
						// Keep the request key cancelled so an old browser cannot recreate a deleted file.
						await writeFile(path.join(home, 'cancelled', job.id), '', { mode: 0o600 });
						cancelled.add(home + job.id);
						related.push({ name, id: job.id });
					}
				}
				const retired = path.join(home, 'staging', 'deleted-' + id);
				await rename(path.join(home, 'assets', id), retired);
				// Failed cleanup stays outside the library and is removed during restart.
				await rm(retired, { recursive: true, force: true }).catch(() => console.error('Document deletion cleanup pending', id));
				for (const item of related) {
					unsavedJobs.delete(home + item.id);
					await rm(path.join(home, 'jobs', item.name), { force: true }).catch(() => console.error('Document job cleanup pending', item.id));
				}
				return send(res, 200, { ok: true });
			} finally { occupied = false; }
		}
		if (parts[0] === "assets" && req.method === "GET") {
			if (parts.length === 1) {
				const result = [];
				for (const id of (await readdir(path.join(home, "assets"))).filter(
					(v) => uuid.test(v),
				)) {
					const latest = (await versions(home, id))[0];
					if (!latest) continue;
					const item = await asset(home, id, latest);
					if (
						!url.searchParams.get("sessionId") ||
						item.sessionId === url.searchParams.get("sessionId")
					)
						result.push(item);
				}
				return send(res, 200, {
					assets: result
						.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
						.slice(0, 100),
				});
			}
			if (parts.length === 3 && parts[2] === "versions") {
				const result = await Promise.all(
					(await versions(home, parts[1])).map((v) => asset(home, parts[1], v)),
				);
				return send(res, 200, { versions: result });
			}
			check(
				parts.length === 4 &&
					["download", "structure", "changes"].includes(parts[3]),
				404,
				"接口不存在",
			);
			const item = await asset(home, parts[1], Number(parts[2]));
			const dir = path.join(home, "assets", item.id, String(item.version));
			if (parts[3] !== "download")
				return send(
					res,
					200,
					await jsonFile(path.join(dir, parts[3] + ".json")),
				);
			const bytes = await readFile(path.join(dir, "file." + item.format));
			res.writeHead(200, {
				"Content-Type": mime[item.format as keyof typeof mime],
				"Content-Length": bytes.length,
				"Content-Disposition":
					"attachment; filename*=UTF-8''" + encodeURIComponent(item.fileName),
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			});
			return res.end(bytes);
		}
		if (parts[0] === "jobs" && parts.length >= 2) {
			check(uuid.test(parts[1]), 400, "任务标识无效");
			if (req.method === "DELETE" && parts.length === 2) {
				// Register cancellation before awaiting disk I/O, including a POST still in transit.
				cancelled.add(home + parts[1]);
				active.get(home + parts[1])?.abort();
				await writeFile(path.join(home, "cancelled", parts[1]), "", {
					mode: 0o600,
				});
				const job = await jobFile(home, parts[1]).catch(() => ({
					id: parts[1],
					status: "cancelled",
					assetId: null,
					version: null,
					error: "文档处理已取消",
					canRecover: false,
					sessionId: "",
					createdAt: new Date().toISOString(),
				}));
				return send(res, 200, publicJob(job));
			}
			const job = await jobFile(home, parts[1]).catch((error) => {
				if (req.method === "GET" && cancelled.has(home + parts[1]))
					return {
						id: parts[1],
						status: "cancelled",
						assetId: null,
						version: null,
						error: "文档处理已取消",
						canRecover: false,
						sessionId: "",
						createdAt: new Date().toISOString(),
					};
				throw error;
			});
			if (req.method === "GET" && parts.length === 2)
				return send(res, 200, publicJob(job));
			if (req.method === "POST" && parts[2] === "retry" && parts.length === 3) {
				if (job.status === "ready") return send(res, 200, publicJob(job));
				check(
					job.plan && terminal.has(job.status),
					409,
					"任务仍在处理或不能重试",
				);
				await admission(home);
				try {
					cancelled.delete(home + job.id);
					await rm(path.join(home, "cancelled", job.id), { force: true });
					const retry = { ...job, status: "queued", error: null };
					await save(path.join(home, "jobs", job.id + ".json"), retry);
					unsavedJobs.delete(home + job.id);
					void runJob(home, retry, new AbortController());
					return send(res, 202, publicJob(retry));
				} catch (error) {
					occupied = false;
					throw error;
				}
			}
		}
		if (
			req.method === "POST" &&
			(url.pathname === "/jobs" || url.pathname === "/upload")
		) {
			const upload = url.pathname === "/upload";
			const id = String(req.headers["idempotency-key"] || "");
			check(uuid.test(id), 400, "缺少有效任务标识");
			const bytes = await body(req, upload ? 20 * 1024 * 1024 : 600 * 1024);
			check(
				!cancelled.has(home + id),
				409,
				"此文档任务已取消，请使用重试制作文件。",
			);
			const requestHash = createHash("sha256")
				.update(bytes)
				.update(String(req.headers["x-file-name"] || ""))
				.update(String(req.headers["x-chat-session"] || ""))
				.digest("hex");
			const existing = await jobFile(home, id).catch(() => null);
			if (existing) {
				check(
					existing.requestHash === requestHash,
					409,
					"此任务标识已被其他内容使用",
				);
				return send(res, 200, publicJob(existing));
			}
			let plan, request, format, fileName, sessionId;
			if (upload) {
				fileName = documentName.parse(
					decodeURIComponent(String(req.headers["x-file-name"] || "")),
				);
				check(
					/\.(docx|xlsx)$/.test(fileName) &&
						bytes.length > 4 &&
						bytes.readUInt32LE(0) === 0x04034b50,
					400,
					"请上传有效的 DOCX / XLSX 文件",
				);
				format = fileName.endsWith(".xlsx") ? "xlsx" : "docx";
				sessionId = String(req.headers["x-chat-session"] || "");
			} else {
				const data = JSON.parse(bytes.toString("utf8"));
				plan = documentPlan.parse(data.plan);
				request = documentJobRequest.parse(data.request);
				format = request.format;
				sessionId = request.sessionId;
				if (plan.kind === "edit") {
					check(
						request.sourceArtifactId === plan.sourceArtifactId &&
							request.baseVersion === plan.baseVersion,
						400,
						"修改计划与选择的文件不一致",
					);
					const source = await asset(
						home,
						plan.sourceArtifactId,
						plan.baseVersion,
					);
					check(
						source.format === format &&
							(await versions(home, source.id))[0] === plan.baseVersion,
						409,
						"请重新选择文件的最新版本",
					);
					fileName = source.fileName;
				} else {
					check(
						!request.sourceArtifactId &&
							(plan.kind === "create_word" ? "docx" : "xlsx") === format,
						400,
						"文件格式与任务不一致",
					);
					fileName = plan.fileName;
				}
			}
			check(
				sessionId.length > 0 && sessionId.length <= 128,
				400,
				"聊天标识无效",
			);
			await admission(home);
			const job: any = {
				id,
				requestHash,
				plan,
				format,
				fileName,
				sessionId,
				status: "queued",
				assetId: null,
				version: null,
				error: null,
				createdAt: new Date().toISOString(),
				canRecover: !!plan,
			};
			try {
				if (upload) {
					job.sourcePath = path.join(home, "uploads", id);
					await writeFile(job.sourcePath, bytes, { mode: 0o600, flag: "wx" });
				}
				await save(path.join(home, "jobs", id + ".json"), job);
			} catch (e) {
				occupied = false;
				if (job.sourcePath) await rm(job.sourcePath, { force: true });
				throw e;
			}
			void runJob(home, job, new AbortController());
			return send(res, 202, publicJob(job));
		}
		throw new HttpError(404, "接口不存在");
	} catch (error) {
		const invalid =
			error instanceof SyntaxError ||
			(error as any)?.name === "ZodError" ||
			error instanceof URIError;
		send(res, error instanceof HttpError ? error.status : invalid ? 400 : 500, {
			error:
				error instanceof HttpError
					? error.message
					: invalid
					? "文档计划或文件参数无效，请重新生成。"
					: "文档服务暂时不可用，请稍后重试。",
		});
	}
});
server.requestTimeout = 120000;
process.on('SIGTERM', () => { stopping = true; server.close(); });
server.listen(
	Number(process.env.PORT || 3010),
	process.env.DOCUMENT_HOST || "0.0.0.0",
);
