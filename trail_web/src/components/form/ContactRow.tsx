import type { ContactIn } from '@/types'
import { CHANNEL_KINDS, CHANNEL_PLATFORMS } from '@/constants'
import { Select } from '@/components/shared/Select'
import DeleteIcon from '@/icons/delete.svg'

interface ContactRowProps {
  contact: ContactIn
  index: number
  onChange: (index: number, field: keyof ContactIn, value: string) => void
  onDelete: (index: number) => void
}

export function ContactRow({ contact, index, onChange, onDelete }: ContactRowProps) {
  return (
    <div className="contact-row" data-row={index}>
      <Select
        value={contact.kind}
        options={CHANNEL_KINDS.map(k => ({ value: k.v, label: k.zh }))}
        onChange={(v) => onChange(index, 'kind', v)}
      />
      <Select
        value={contact.channel}
        options={CHANNEL_PLATFORMS.map(p => ({ value: p.v, label: p.zh }))}
        onChange={(v) => onChange(index, 'channel', v)}
      />
      <input
        className="field__input"
        value={contact.name}
        onChange={e => onChange(index, 'name', e.target.value)}
        placeholder="名称 *"
        required={!!contact.name}
      />
      <input
        className="field__input"
        value={contact.target || ''}
        onChange={e => onChange(index, 'target', e.target.value)}
        placeholder="标识 / 号"
      />
      <input
        className="field__input"
        value={contact.note || ''}
        onChange={e => onChange(index, 'note', e.target.value)}
        placeholder="备注"
      />
      <button type="button" className="contact-row__del" onClick={() => onDelete(index)} title="删除此行">
        <img src={DeleteIcon} width={15} height={15} alt="删除" />
      </button>
    </div>
  )
}
