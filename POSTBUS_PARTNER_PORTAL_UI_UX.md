# Partner portal UI

Layout: `components/affiliates/partner-shell.tsx`.

Sidebar: Overview, Referral links, Campaigns, My referrals, Commissions, Payouts, Profile, Help & support.

Header: Partner workspace, status chip, sign out.

Pages: `components/affiliates/partner-portal.tsx`. Uses existing Card, Button, Input, Skeleton, EmptyState, PageHeader, recharts AreaChart, PostBus rose chart stroke.

Mobile: drawer via menu button (`lg:hidden`). Desktop: 16rem sidebar.

Empty and error states: missing schema message is explicit. Payouts copy is “Payout requests are not available yet.”
