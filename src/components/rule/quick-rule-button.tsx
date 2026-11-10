import { DeleteOutlineRounded, PlaylistAddRounded } from '@mui/icons-material'
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import * as yaml from 'js-yaml'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import { readProfileFile, saveProfileFile } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import { formatRule, parseRuleTarget } from '@/utils/quick-rule'
import { parseYamlSafe } from '@/utils/yaml'

const MERGE_UID = 'Merge'
const RULES_KEY = 'prepend-rules'

type MergeConfig = Record<string, unknown>
type RuleMode = 'proxy' | 'direct'

const readPrependRules = (config: MergeConfig): string[] | null => {
  const raw = config[RULES_KEY]
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((rule) => typeof rule !== 'string')) {
    return null
  }
  return raw
}

export const QuickRuleButton = () => {
  const { t } = useTranslation()
  const { proxyView } = useProxiesData()
  const { refreshRules } = useAppRefreshers()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mergeConfig, setMergeConfig] = useState<MergeConfig | null>(null)
  const [rules, setRules] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const [mode, setMode] = useState<RuleMode>('proxy')
  const [group, setGroup] = useState('')

  const groups = useMemo(
    () =>
      (proxyView?.groups ?? [])
        .filter((item) => !item.hidden)
        .map((item) => item.name),
    [proxyView],
  )

  const loadMerge = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const parsed = parseYamlSafe(await readProfileFile(MERGE_UID))
      if (parsed === undefined) {
        setLoadFailed(true)
        return
      }
      const config: unknown = parsed ?? {}
      if (
        typeof config !== 'object' ||
        config === null ||
        Array.isArray(config)
      ) {
        setLoadFailed(true)
        return
      }
      const prependRules = readPrependRules(config as MergeConfig)
      if (!prependRules) {
        setLoadFailed(true)
        return
      }
      setMergeConfig(config as MergeConfig)
      setRules(prependRules)
    } catch (error) {
      showNotice.error(error)
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpen = useLockFn(async () => {
    setTarget('')
    setGroup((current) => current || groups[0] || '')
    setMergeConfig(null)
    setRules([])
    setOpen(true)
    await loadMerge()
  })

  const persistRules = async (nextRules: string[]) => {
    if (!mergeConfig) return false

    const nextConfig: MergeConfig = { ...mergeConfig }
    if (nextRules.length > 0) {
      nextConfig[RULES_KEY] = nextRules
    } else {
      delete nextConfig[RULES_KEY]
    }

    setSaving(true)
    try {
      const text = yaml.dump(nextConfig, { lineWidth: -1, noRefs: true })
      const result = await mutate(() => saveProfileFile(MERGE_UID, text), {
        id: `save-profile-file:${MERGE_UID}`,
        errorNotice: false,
      })
      if (!(result.ok && result.value === true)) {
        await loadMerge()
        return false
      }

      setMergeConfig(nextConfig)
      setRules(nextRules)
      await refreshRules()
      showNotice.success('rules.page.quickRule.feedback.saved')
      return true
    } catch (error) {
      showNotice.error(error)
      return false
    } finally {
      setSaving(false)
    }
  }

  const policy = mode === 'direct' ? 'DIRECT' : group.trim()
  const ruleTarget = parseRuleTarget(target)
  const previewRule = ruleTarget && policy ? formatRule(ruleTarget, policy) : ''

  const handleAdd = useLockFn(async () => {
    if (!previewRule) {
      showNotice.error('rules.page.quickRule.feedback.invalidTarget')
      return
    }
    if (rules.includes(previewRule)) {
      showNotice.info('rules.page.quickRule.feedback.duplicate')
      return
    }
    if (await persistRules([...rules, previewRule])) {
      setTarget('')
    }
  })

  const handleDelete = useLockFn(async (rule: string) => {
    await persistRules(rules.filter((item) => item !== rule))
  })

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<PlaylistAddRounded />}
        onClick={handleOpen}
      >
        {t('rules.page.quickRule.trigger')}
      </Button>

      {open && (
        <Dialog open onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('rules.page.quickRule.title')}</DialogTitle>

          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('rules.page.quickRule.description')}
            </Typography>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : loadFailed ? (
              <Typography variant="body2" color="error">
                {t('rules.page.quickRule.feedback.parseFailed')}
              </Typography>
            ) : (
              <>
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  label={t('rules.page.quickRule.form.target')}
                  placeholder={t('rules.page.quickRule.form.targetPlaceholder')}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== 'Enter' ||
                      event.nativeEvent.isComposing
                    ) {
                      return
                    }
                    event.preventDefault()
                    if (previewRule && !saving) void handleAdd()
                  }}
                />

                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={mode}
                  onChange={(_, value: RuleMode | null) =>
                    value && setMode(value)
                  }
                  sx={{ mt: 1.5 }}
                >
                  <ToggleButton value="proxy">
                    {t('rules.page.quickRule.form.proxy')}
                  </ToggleButton>
                  <ToggleButton value="direct">
                    {t('rules.page.quickRule.form.direct')}
                  </ToggleButton>
                </ToggleButtonGroup>

                {mode === 'proxy' && (
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={groups}
                    inputValue={group}
                    onInputChange={(_, value) => setGroup(value)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={t('rules.page.quickRule.form.proxyGroup')}
                        sx={{ mt: 1.5 }}
                      />
                    )}
                  />
                )}

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mt: 1.5,
                    minHeight: 20,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    userSelect: 'text',
                  }}
                >
                  {previewRule}
                </Typography>

                <Button
                  fullWidth
                  variant="contained"
                  sx={{ mt: 1 }}
                  disabled={!previewRule || saving}
                  onClick={handleAdd}
                >
                  {t('rules.page.quickRule.actions.add')}
                </Button>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t('rules.page.quickRule.list.title')}
                </Typography>

                {rules.length > 0 ? (
                  <List dense disablePadding>
                    {rules.map((rule) => (
                      <ListItem
                        key={rule}
                        disableGutters
                        secondaryAction={
                          <IconButton
                            edge="end"
                            size="small"
                            title={t('shared.actions.delete')}
                            disabled={saving}
                            onClick={() => handleDelete(rule)}
                          >
                            <DeleteOutlineRounded fontSize="small" />
                          </IconButton>
                        }
                      >
                        <ListItemText
                          primary={rule}
                          slotProps={{
                            primary: {
                              variant: 'body2',
                              sx: { wordBreak: 'break-all' },
                            },
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('rules.page.quickRule.list.empty')}
                  </Typography>
                )}
              </>
            )}
          </DialogContent>

          <DialogActions>
            <Button variant="outlined" onClick={() => setOpen(false)}>
              {t('shared.actions.close')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  )
}
