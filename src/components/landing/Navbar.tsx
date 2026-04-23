import { lazy, Suspense, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const WalletButtonSlot = lazy(() => import("@/components/wallet/WalletButtonSlot"));

const WalletButtonFallback = () => (
  <div className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 shadow-sm">
    Wallet
  </div>
);

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "Benefits", href: "#benefits" },
  { label: "Contact", href: "#contact" },
];

const Navbar = () => {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 glass-card"
    >
      <div className="container mx-auto flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16 lg:h-20">
        {/* Brand */}
        <div className="flex-shrink-0">
          <a href="/" className="flex items-center gap-2.5 group">
            {/* Modern crypto logo icon */}
            <div className="relative w-9 h-9 rounded-lg overflow-hidden shadow-md">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 via-indigo-500 to-cyan-500 opacity-90 group-hover:opacity-100 transition-opacity" />
              <div className="absolute inset-0.5 rounded-[6px] bg-gradient-to-br from-purple-600 to-cyan-600 opacity-50" />
              {/* Crypto wave pattern inside */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 12C6 9.239 8.239 7 11 7C13.761 7 16 9.239 16 12M6 12C6 14.761 8.239 17 11 17C13.761 17 16 14.761 16 12M6 12H16" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
              </svg>
            </div>
            {/* Brand text */}
            <div className="flex flex-col gap-0">
              <span className="font-bold text-base tracking-wide text-foreground group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-purple-500 group-hover:to-cyan-500 group-hover:bg-clip-text transition-all duration-300">zyxolat</span>
              <span className="text-[10px] font-semibold text-purple-400 tracking-wider uppercase opacity-75">Pay</span>
            </div>
          </a>
        </div>

        {/* Desktop */}
        <div className="hidden lg:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
          <Suspense fallback={<WalletButtonFallback />}>
            <WalletButtonSlot />
          </Suspense>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-6" onClick={() => navigate('/auth/login')}>
            Get Started
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          className="lg:hidden text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="lg:hidden overflow-hidden bg-card border-t border-border"
          >
            <div className="flex flex-col gap-4 px-4 py-6">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <Suspense fallback={<WalletButtonFallback />}>
                <WalletButtonSlot />
              </Suspense>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold w-full" onClick={() => { navigate('/auth/login'); setMobileOpen(false); }}>
                Get Started
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};

export default Navbar;
