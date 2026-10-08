import React, { useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Zap,
  ArrowLeft,
  Lock,
  Pencil,
  Plus,
  Plug,
  Trash2,
  ChevronDown,
  Compass,
  ExternalLink,
  Terminal,
  FileText,
  FilePen,
  SquarePen,
  FolderOpen,
  Send,
  Search,
  Globe,
  KeyRound,
  Clock,
  Brain,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { t } from '../i18n'
import apiClient from '../api/client'
import type { ApiResult } from '../api/client'
import type { ToolInfo, SkillInfo, SkillContent, McpServerConfig } from '../types'
import { Toggle } from './settings/primitives'
import Markdown from '../components/Markdown'
import { DocActions, DocEditor, DocNotice } from '../components/DocEditor'
import { createDocEditorStore, docRefusal } from '../store/docEditorStore'
import { askConfirm } from '../store/confirmStore'
import McpEditorModal from './skills/McpEditorModal'
import SkillAddModal from './skills/SkillAddModal'
import { parseSkillFrontmatter } from './skills/frontmatter'
import { MCP_TRANSPORT_LABELS, mcpTransport } from './skills/mcpConfig'
import { product } from '@product'

interface SkillsPageProps {
  baseUrl: string
}

const SKILL_HUB_URL = 'https://skills.cowagent.ai/'
const TOOLS_COLLAPSED_COUNT = 4
const MCP_POLL_INTERVAL_MS = 1500
const MCP_POLL_MAX_MS = 120000

const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: Terminal,
  edit: SquarePen,
  read: FileText,
  write: FilePen,
  ls: FolderOpen,
  send: Send,
  web_search: Search,
  browser: Globe,
  env_config: KeyRound,
  scheduler: Clock,
  memory_get: Brain,
  memory_search: Brain,
}

/**
 * Skills are addressed by name, not by path: which file a name resolves to is
 * the loader's business, and a builtin skill's file sits outside the workspace.
 */
interface SkillRef {
  name: string
  label: string
}

/** Created at module scope so an unsaved edit survives a route change. */
const skillEditor = createDocEditorStore<SkillRef, SkillContent & ApiResult>({
  keyOf: (doc) => doc.name,
  read: (doc) => apiClient.readSkill(doc.name),
  write: (doc, content, expectedMtime) =>
    apiClient.writeSkill({ name: doc.name, content, expectedMtime }),
  refusal: (data) => (data.ships_with_install ? t('skill_builtin_readonly') : docRefusal(data)),
})

/** A skill's read-only view: frontmatter as a titled header, body as markdown. */
const SkillContentView: React.FC<{ content: string }> = ({ content }) => {
  const { fields, body } = parseSkillFrontmatter(content)
  return (
    <>
      {fields.length > 0 && (
        <div className="mb-5 pb-5 border-b border-subtle space-y-2">
          {fields.map(([key, value]) => (
            <div key={key} className="flex gap-3 text-sm">
              <span className="flex-shrink-0 w-24 font-medium text-content-tertiary">{key}</span>
              <span className="flex-1 min-w-0 text-content break-words">{value}</span>
            </div>
          ))}
        </div>
      )}
      <Markdown content={body} />
    </>
  )
}

function mcpStatusLabel(status?: string): string {
  const key: Record<string, string> = {
    ready: 'mcp_status_ready',
    pending: 'mcp_status_pending',
    failed: 'mcp_status_failed',
    needs_auth: 'mcp_status_needs_auth',
    disabled: 'mcp_status_disabled',
    idle: 'mcp_status_idle',
  }
  return t(key[status || ''] || 'mcp_status_idle')
}

function mcpStatusClass(status?: string): string {
  if (status === 'ready') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (status === 'failed') return 'bg-red-500/10 text-red-500'
  if (status === 'needs_auth') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  if (status === 'disabled') return 'bg-inset-2 text-content-tertiary'
  return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
}

const cardClass = 'rounded-card border border-default bg-surface p-4 flex items-start gap-3'
const iconBtnClass = 'flex-shrink-0 p-1 -my-1 rounded text-content-tertiary transition-colors cursor-pointer'

const SkillsPage: React.FC<SkillsPageProps> = ({ baseUrl }) => {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // undefined: closed; null: adding; a config: editing that server.
  const [editing, setEditing] = useState<McpServerConfig | null | undefined>(undefined)
  const [addingSkill, setAddingSkill] = useState(false)
  const [freshSkills, setFreshSkills] = useState<Set<string>>(new Set())
  const [mcpError, setMcpError] = useState('')
  const [skillError, setSkillError] = useState('')
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>()

  const doc = skillEditor((s) => s.doc)
  const content = skillEditor((s) => s.content)
  const docLoading = skillEditor((s) => s.loading)
  const readonly = skillEditor((s) => s.readonly)
  const edit = skillEditor((s) => s.edit)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const flash = (text: string) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 2600)
  }

  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // Saved servers start in the background, so keep refreshing while any is still loading.
  const mcpPollDeadline = useRef(0)
  useEffect(() => {
    if (!servers.some((s) => s.status === 'pending')) {
      mcpPollDeadline.current = 0
      return
    }
    if (!mcpPollDeadline.current) mcpPollDeadline.current = Date.now() + MCP_POLL_MAX_MS
    if (Date.now() > mcpPollDeadline.current) return
    const timer = setTimeout(() => {
      apiClient
        .getMcpServers()
        .then((data) => setServers(data.servers || []))
        .catch(() => {})
    }, MCP_POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [servers])

  const loadData = async () => {
    try {
      setLoading(true)
      setMcpError('')
      const [toolsData, skillsData, mcpData] = await Promise.all([
        apiClient.getTools(),
        apiClient.getSkills(),
        // A broken mcp.json must not take the tools and skills lists down with it.
        apiClient.getMcpServers().catch((err: Error) => {
          setMcpError(`${t('mcp_load_failed')}: ${err.message}`)
          return { servers: [] as McpServerConfig[] }
        }),
      ])
      setTools(toolsData || [])
      setSkills(skillsData || [])
      setServers(mcpData.servers || [])
    } catch (err) {
      console.error('Failed to load skills:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    apiClient.setBaseUrl(baseUrl)
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  const toggle = async (skill: SkillInfo, enabled: boolean) => {
    // Optimistic flip; revert on failure.
    setSkills((prev) => prev.map((s) => (s.name === skill.name ? { ...s, enabled } : s)))
    try {
      const res = await apiClient.toggleSkill(skill.name, enabled ? 'open' : 'close')
      if (res.status !== 'success') throw new Error()
    } catch {
      setSkills((prev) => prev.map((s) => (s.name === skill.name ? { ...s, enabled: !enabled } : s)))
      flash(t('skill_toggle_error'))
    }
  }

  // The card's pencil opens the viewer and jumps straight into editing,
  // skipping the read-only view. `startEdit` no-ops for a read-only skill, so
  // the built-in ones simply open to their content.
  const openSkillForEdit = async (skill: SkillInfo) => {
    await skillEditor
      .getState()
      .open({ name: skill.name, label: skill.display_name || skill.name })
    await skillEditor.getState().startEdit()
  }

  const closeViewer = async () => {
    if (!(await skillEditor.getState().close())) return
    // A saved edit can change the name and description in the frontmatter, so
    // the cards behind this panel may be out of date.
    void loadData()
  }

  const persistServers = async (next: McpServerConfig[]) => {
    const res = await apiClient.saveMcpServers(next)
    if (res.status !== 'success') throw new Error(res.message || t('mcp_save_error'))
    mcpPollDeadline.current = 0
    setServers(res.servers || next)
  }

  const saveFromEditor = async (next: McpServerConfig[], notice: string) => {
    await persistServers(next)
    setEditing(undefined)
    flash(notice)
  }

  const removeServer = async (name: string) => {
    const ok = await askConfirm({ titleKey: 'mcp_delete', msgKey: 'mcp_delete_confirm', okKey: 'mcp_delete' })
    if (!ok) return
    setMcpError('')
    try {
      await persistServers(servers.filter((item) => item.name !== name))
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : t('mcp_save_error'))
    }
  }

  const reloadSkills = async () => {
    setSkills((await apiClient.getSkills()) || [])
  }

  const onSkillsInstalled = (names: string[]) => {
    void reloadSkills()
    setFreshSkills(new Set(names))
    setTimeout(() => setFreshSkills(new Set()), 2600)
  }

  const uninstall = async (name: string) => {
    const ok = await askConfirm({ titleKey: 'skill_delete', msgKey: 'skill_delete_confirm', okKey: 'skill_delete' })
    if (!ok) return
    setSkillError('')
    try {
      const res = await apiClient.deleteSkill(name)
      if (res.status !== 'success') throw new Error(res.message || t('skill_delete_error'))
      await reloadSkills()
    } catch (err) {
      setSkillError(`${t('skill_delete_error')}: ${err instanceof Error ? err.message : ''}`)
    }
  }

  const visibleTools = toolsExpanded ? tools : tools.slice(0, TOOLS_COLLAPSED_COUNT)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <div>
          <h2 className="text-xl font-bold text-content">{t('skills_title')}</h2>
          <p className="text-xs text-content-tertiary mt-1">{t('skills_desc')}</p>
        </div>
      </div>

      <DocNotice store={skillEditor} />

      {doc ? (
        <div className="flex-1 flex flex-col min-h-0 border-t border-default">
          <div className="flex items-center gap-3 px-6 py-3 flex-shrink-0 border-b border-subtle">
            <button
              onClick={() => void closeViewer()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-sm text-content-secondary hover:bg-inset border border-strong transition-colors cursor-pointer"
            >
              <ArrowLeft size={14} />
              {t('skill_back')}
            </button>
            <h3 className="flex-1 text-sm font-semibold text-content truncate">
              {doc.label}
              {edit?.dirty && (
                <span className="text-accent" title={t('ws_edit_unsaved')}>
                  {' '}
                  {'\u2022'}
                </span>
              )}
            </h3>
            {readonly && !docLoading && (
              <span
                title={readonly}
                className="inline-flex items-center gap-1.5 max-w-[45%] px-2 py-1 rounded-btn text-xs text-content-tertiary bg-inset"
              >
                <Lock size={11} className="flex-shrink-0" />
                <span className="truncate">{readonly}</span>
              </span>
            )}
            <DocActions store={skillEditor} textareaRef={editorRef} />
          </div>
          {edit ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <DocEditor key={doc.name} store={skillEditor} textareaRef={editorRef} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 py-6">
                {docLoading ? (
                  <div className="flex items-center text-content-tertiary py-8">
                    <Loader2 size={16} className="animate-spin mr-2" />
                  </div>
                ) : (
                  <SkillContentView content={content} />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto border-t border-default">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-content-tertiary">
              <Loader2 size={18} className="animate-spin mr-2" />
              {t('skills_loading')}
            </div>
          ) : (
            <div className="space-y-10">
              <Section
                title={t('tools_section_title')}
                count={tools.length}
                action={
                  tools.length > TOOLS_COLLAPSED_COUNT && (
                    <LinkBtn onClick={() => setToolsExpanded((v) => !v)}>
                      {t(toolsExpanded ? 'tools_collapse' : 'tools_show_all')}
                      <ChevronDown size={12} className={`transition-transform ${toolsExpanded ? 'rotate-180' : ''}`} />
                    </LinkBtn>
                  )
                }
              >
                {tools.length === 0 ? (
                  <p className="text-sm text-content-tertiary py-2">{t('tools_empty')}</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {visibleTools.map((tool) => {
                      const Icon = TOOL_ICONS[tool.name] || Wrench
                      return (
                        <div key={tool.name} className={cardClass}>
                          <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                            <Icon size={15} className="text-blue-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="block text-sm font-medium text-content font-mono truncate">{tool.name}</span>
                            <p className="text-xs text-content-tertiary leading-relaxed mt-1 line-clamp-2">{tool.description || '--'}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <Section
                title={t('mcp_section_title')}
                count={servers.length}
                action={
                  <ActionBtn onClick={() => setEditing(null)}>
                    <Plus size={12} />
                    {t('mcp_add')}
                  </ActionBtn>
                }
              >
                {mcpError && <p className="mb-3 text-sm text-danger">{mcpError}</p>}
                {servers.length === 0 ? (
                  !mcpError && (
                    <EmptyState icon={Plug} title={t('mcp_empty')} hint={t('mcp_empty_hint')} tone="amber" />
                  )
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {servers.map((server) => {
                      const type = mcpTransport(server)
                      const summary =
                        type === 'stdio'
                          ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
                          : server.url || ''
                      return (
                        <div
                          key={server.name}
                          onClick={() => setEditing(server)}
                          className={`${cardClass} cursor-pointer hover:border-strong transition-colors`}
                        >
                          <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                            <Plug size={15} className={server.status === 'disabled' ? 'text-content-tertiary' : 'text-amber-500'} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-content font-mono truncate">{server.name}</span>
                              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-inset-2 text-content-tertiary">
                                {MCP_TRANSPORT_LABELS[type] || type}
                              </span>
                              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] ${mcpStatusClass(server.status)}`}>
                                {mcpStatusLabel(server.status)}
                              </span>
                              <span className="flex-1" />
                              <button
                                type="button"
                                title={t('mcp_edit')}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditing(server)
                                }}
                                className={`${iconBtnClass} hover:text-content-secondary`}
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                type="button"
                                title={t('mcp_delete')}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void removeServer(server.name)
                                }}
                                className={`${iconBtnClass} hover:text-red-500`}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                            <p className="text-xs text-content-tertiary font-mono truncate" title={summary}>
                              {summary || '--'}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <Section
                title={t('skills_section_title')}
                count={skills.length}
                action={
                  <>
                    {!product.skills?.uploadOnly && (
                      <a
                        href={SKILL_HUB_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-btn text-xs text-content-tertiary hover:text-content-secondary hover:bg-surface-2 transition-colors"
                      >
                        <Compass size={12} />
                        {t('skills_hub_btn')}
                        <ExternalLink size={10} className="opacity-60" />
                      </a>
                    )}
                    <ActionBtn onClick={() => setAddingSkill(true)}>
                      <Plus size={12} />
                      {t('skill_add')}
                    </ActionBtn>
                  </>
                }
              >
                {skillError && <p className="mb-3 text-sm text-danger">{skillError}</p>}
                {skills.length === 0 ? (
                  <EmptyState icon={Zap} title={t('skills_empty')} hint={t(product.skills?.uploadOnly ? 'skills_empty_hint_upload' : 'skills_empty_hint')} tone="accent" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {skills.map((skill) => (
                      <div
                        key={skill.name}
                        onClick={() =>
                          void skillEditor
                            .getState()
                            .open({ name: skill.name, label: skill.display_name || skill.name })
                        }
                        title={t('skill_open_hint')}
                        className={`${cardClass} cursor-pointer transition-all ${
                          freshSkills.has(skill.name)
                            ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]'
                            : 'hover:border-strong'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
                          <Zap size={15} className={skill.enabled ? 'text-accent' : 'text-content-tertiary'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-content truncate flex-1">
                              {skill.display_name || skill.name}
                            </span>
                            <button
                              type="button"
                              title={t('skill_edit_hint')}
                              onClick={(e) => {
                                e.stopPropagation()
                                void openSkillForEdit(skill)
                              }}
                              className={`${iconBtnClass} hover:text-content-secondary`}
                            >
                              <Pencil size={11} />
                            </button>
                            {skill.deletable && (
                              <button
                                type="button"
                                title={t('skill_delete')}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void uninstall(skill.name)
                                }}
                                className={`${iconBtnClass} hover:text-red-500`}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                            <span onClick={(e) => e.stopPropagation()}>
                              <Toggle checked={skill.enabled} onChange={(v) => toggle(skill, v)} />
                            </span>
                          </div>
                          <p className="text-xs text-content-tertiary leading-relaxed line-clamp-2">{skill.description || '--'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
      )}

      <McpEditorModal
        server={editing}
        existing={servers}
        onClose={() => setEditing(undefined)}
        onSave={saveFromEditor}
      />
      <SkillAddModal open={addingSkill} onClose={() => setAddingSkill(false)} onInstalled={onSkillsInstalled} />

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-btn bg-neutral-900/90 text-white text-sm shadow-lg pointer-events-none">
          {notice}
        </div>
      )}
    </div>
  )
}

const Section: React.FC<{ title: string; count: number; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  count,
  action,
  children,
}) => (
  <section>
    <div className="flex items-center gap-2 mb-3 min-h-[28px]">
      <span className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">{title}</span>
      {count > 0 && (
        <span className="px-1.5 py-0.5 rounded-full text-xs bg-inset-2 text-content-tertiary min-w-[20px] text-center">{count}</span>
      )}
      <div className="ml-auto flex items-center gap-1">{action}</div>
    </div>
    {children}
  </section>
)

const ActionBtn: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-medium text-accent bg-accent-soft hover:brightness-95 dark:hover:brightness-110 cursor-pointer transition-all"
  >
    {children}
  </button>
)

const LinkBtn: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-btn text-xs text-content-tertiary hover:text-content-secondary hover:bg-surface-2 cursor-pointer transition-colors"
  >
    {children}
  </button>
)

const EmptyState: React.FC<{ icon: LucideIcon; title: string; hint: string; tone: 'accent' | 'amber' }> = ({
  icon: Icon,
  title,
  hint,
  tone,
}) => (
  <div className="flex flex-col items-center justify-center px-4 py-7 rounded-card border border-dashed border-strong text-center">
    <div
      className={`w-10 h-10 mb-2.5 rounded-card flex items-center justify-center ${
        tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-amber-500/10 text-amber-500'
      }`}
    >
      <Icon size={17} />
    </div>
    <p className="text-sm font-medium text-content-secondary">{title}</p>
    <p className="text-xs text-content-tertiary mt-1">{hint}</p>
  </div>
)

export default SkillsPage
