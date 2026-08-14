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
    t('general.openFriend', lang),
  )
}
