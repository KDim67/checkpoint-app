import {
  BadgeCheck, Briefcase, CalendarClock, Car, CreditCard, FileText, Globe, Heart,
  Home, KeyRound, Phone, Plane, Server, ShieldCheck, type LucideIcon
} from 'lucide-react'
import type { KindIcon } from '../../../../shared/renewalKinds'

/** a fixed set, so a stored name can never pick something that isn't an icon */
export const KIND_ICON_COMPONENTS: Record<KindIcon, LucideIcon> = {
  globe: Globe,
  shield: ShieldCheck,
  key: KeyRound,
  card: CreditCard,
  badge: BadgeCheck,
  calendar: CalendarClock,
  home: Home,
  car: Car,
  heart: Heart,
  plane: Plane,
  file: FileText,
  server: Server,
  phone: Phone,
  briefcase: Briefcase
}

export function KindIconView({ icon, size = 16 }: { icon: KindIcon; size?: number }): React.JSX.Element {
  const Icon = KIND_ICON_COMPONENTS[icon] ?? CalendarClock
  return <Icon size={size} aria-hidden="true" />
}
