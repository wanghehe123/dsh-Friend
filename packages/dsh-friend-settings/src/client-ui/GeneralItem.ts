import { resolveUiLanguage, type FriendCoreSettings } from '../core-settings.ts'
import { t } from '../i18n.ts'
import { friendReact } from './friend-react.ts'

export function GeneralItem(props: {
  core: FriendCoreSettings
  onOpenCenter?: () => void
  systemLanguage?: string
}): unknown {
  const { createElement } = friendReact()
  const lang = resolveUiLanguage(props.core.language, props.systemLanguage)
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-friend-general-item',
      onClick: () => props.onOpenCenter?.(),
    },
    createElement('span', { className: 'dsh-friend-row-text' },
      createElement('span', { className: 'dsh-friend-row-title' }, t('general.openFriend', lang)),
      createElement('span', { className: 'dsh-friend-row-desc' }, t('general.openFriendHint', lang)),
    ),
    createElement('span', { className: 'dsh-friend-pill' }, t('general.open', lang)),
  )
}
