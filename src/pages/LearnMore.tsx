import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Coins,
  Globe2,
  Landmark,
  ShieldCheck,
  Signal,
  Store,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const problemPoints = [
  'Many communities across Africa, rural areas, and disaster zones operate with poor or no internet.',
  'Connectivity can disappear while a payment is in progress, which makes standard crypto checkout unreliable.',
  'Traditional blockchain payments usually expect the sender and receiver to be online at the same time.',
];

const useCases = [
  { icon: Store, title: 'Rural markets', description: 'Merchants can keep serving customers even when coverage drops mid-day.' },
  { icon: Globe2, title: 'Cross-border payments', description: 'Families and traders can exchange value across regions with delayed settlement.' },
  { icon: AlertTriangle, title: 'Disaster relief', description: 'Aid teams can coordinate value transfers in low-infrastructure emergency zones.' },
  { icon: Landmark, title: 'Offline merchant payments', description: 'Local shops can capture payment intent now and settle on-chain once connectivity returns.' },
];

const tokenSupport = [
  { label: 'CELO', detail: 'Native network asset for gas and value transfer.' },
  { label: 'Delayed Settlement', detail: 'OfflinePay releases locked CELO only after the timer expires for the intended recipient.' },
];

export const LearnMorePage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.2),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.22),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.35),_rgba(2,6,23,0.96))]" />
        <div className="container relative z-10 mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Button variant="ghost" className="text-slate-100 hover:bg-white/10 hover:text-white" onClick={() => navigate('/')}>
              <ArrowLeft />
              Back
            </Button>
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1 text-xs font-medium uppercase tracking-[0.25em] text-emerald-200">
              OfflinePay explainer
            </div>
          </div>

          <div className="grid gap-10 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-24">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="max-w-3xl"
            >
              <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-emerald-200/80">
                Real-world crypto for unreliable networks
              </p>
              <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
                Crypto payments that keep moving when the internet does not.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                OfflinePay is designed for environments where connectivity is fragile. It lets people capture payment intent
                offline, use time-locked release timers, and settle to Celo when the network becomes available again.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="bg-emerald-500 text-white hover:bg-emerald-400" onClick={() => navigate('/auth/login')}>
                  Create Wallet
                  <ArrowRight />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => navigate('/auth/login')}
                >
                  Login
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.55, delay: 0.1 }}
            >
              <Card className="border-white/10 bg-white/5 shadow-2xl shadow-emerald-950/40 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-2xl text-white">Why OfflinePay matters</CardTitle>
                  <CardDescription className="text-slate-300">
                    Built for fintech reality, not perfect-network assumptions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-200">
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <div className="mb-2 flex items-center gap-2 text-emerald-200">
                      <Signal size={16} />
                      <span className="font-semibold">Offline advantage</span>
                    </div>
                    <p>Capture payments in low-connectivity environments and sync to the network later.</p>
                  </div>
                  <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sky-200">
                      <Clock3 size={16} />
                      <span className="font-semibold">Time-locked trust</span>
                    </div>
                    <p>Receivers can withdraw only after the release timer ends, which prevents premature access.</p>
                  </div>
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                    <div className="mb-2 flex items-center gap-2 text-amber-200">
                      <ShieldCheck size={16} />
                      <span className="font-semibold">Safer settlement</span>
                    </div>
                    <p>No permanent fund lock, less accidental loss, and clearer intent before value finalizes on-chain.</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="container mx-auto space-y-8 px-4 py-12 sm:px-6 lg:px-8 lg:space-y-10 lg:py-16">
        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-white/10 bg-slate-900/80 text-slate-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <Globe2 className="text-emerald-300" />
                Problem
              </CardTitle>
              <CardDescription className="text-slate-300">
                Real-world connectivity limits still block everyday crypto payments.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-slate-200">
              {problemPoints.map((point) => (
                <div key={point} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
                  <p>{point}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/80 text-slate-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <CheckCircle2 className="text-emerald-300" />
                Solution
              </CardTitle>
              <CardDescription className="text-slate-300">
                OfflinePay uses a delayed settlement pattern so payment intent is not lost when the network disappears.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-slate-200">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                <p className="font-semibold text-white">OfflinePay enables crypto payments without constant internet.</p>
                <p className="mt-2 text-sm text-slate-200">
                  The app stores and verifies payment details locally, then completes on-chain settlement when a connection comes back.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white">Local capture</p>
                  <p className="mt-2 text-sm text-slate-300">Payment intent is preserved even while devices are offline.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white">On-chain settlement</p>
                  <p className="mt-2 text-sm text-slate-300">The blockchain remains the source of truth once synchronization happens.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <Clock3 className="text-sky-300" />
                Time-Locked Payment System
              </CardTitle>
              <CardDescription className="text-slate-300">
                Designed to reduce trust gaps when sender and receiver are not simultaneously online.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Step 1</p>
                <p className="mt-3 font-semibold text-white">Sender creates a CELO payment with a release timer.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Step 2</p>
                <p className="mt-3 font-semibold text-white">Receiver waits until the timer finishes, then withdraws with the intended wallet.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Step 3</p>
                <p className="mt-3 font-semibold text-white">The UI unlocks automatically at zero and matches the contract release state.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/80 text-slate-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <ShieldCheck className="text-emerald-300" />
                Security Benefits
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-slate-200">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">No permanent fund lock if the recipient never confirms.</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Receivers must explicitly accept, reducing accidental transfers.</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Time windows create a clearer trust boundary for both sides of a payment.</div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-white/10 bg-slate-900/80 text-slate-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <Signal className="text-emerald-300" />
                Offline Advantage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-slate-200">
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4">
                OfflinePay keeps working in low-connectivity environments where standard on-chain checkout would stall.
              </p>
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4">
                The app syncs payment activity to the network when a connection becomes available again.
              </p>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/80 text-slate-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <Coins className="text-amber-300" />
                Supported Tokens
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {tokenSupport.map((token) => (
                <div key={token.label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="text-xl font-semibold text-white">{token.label}</p>
                  <p className="mt-2 text-sm text-slate-300">{token.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-white/10 bg-slate-900/80 text-slate-50">
            <CardHeader>
              <CardTitle className="text-2xl">Use Cases</CardTitle>
              <CardDescription className="text-slate-300">
                OfflinePay is shaped around communities and teams that cannot depend on continuous access.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {useCases.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="mb-4 inline-flex rounded-2xl bg-emerald-400/15 p-3 text-emerald-200">
                    <Icon size={20} />
                  </div>
                  <p className="text-lg font-semibold text-white">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default LearnMorePage;
