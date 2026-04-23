import { ArrowRight, ShieldCheck, Smartphone, WifiOff } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

const metrics = [
  { value: "Offline First", label: "Capture payment intent even with weak connectivity" },
  { value: "Celo Secured", label: "Settle on-chain when the network comes back" },
  { value: "Merchant Ready", label: "Built for real-world field and retail use" },
];

const Hero = () => {
  const navigate = useNavigate();

  return (
    <section className="hero-fintech">
      <div className="hero-fintech__inner">
        <motion.div
          className="hero-fintech__content"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div className="hero-fintech__badge">
            <span className="hero-fintech__badge-dot" aria-hidden="true" />
            Offline payments on Celo
          </div>

          <h1 className="hero-fintech__title">
            Send Payments
            <span className="hero-fintech__title-accent">Without Internet</span>
          </h1>

          <p className="hero-fintech__copy">
            OfflinePay lets teams create payment instructions without network access, then sync them to the Celo blockchain
            the moment connectivity returns. It feels simple for users and dependable enough for real money movement.
          </p>

          <div className="hero-fintech__actions">
            <Button size="lg" onClick={() => navigate("/auth/login")}>
              Start Payment
              <ArrowRight size={18} />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/learn-more")}>
              See How It Works
            </Button>
          </div>

          <div className="hero-fintech__metrics">
            {metrics.map((metric) => (
              <div key={metric.value} className="hero-fintech__metric">
                <div className="hero-fintech__metric-value">{metric.value}</div>
                <div className="hero-fintech__metric-label">{metric.label}</div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          className="hero-fintech__visual"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.1, ease: "easeOut" }}
        >
          <div className="hero-flow">
            <div className="hero-flow__header">
              <span>Offline settlement flow</span>
              <span>Ready to sync</span>
            </div>

            <div className="hero-flow__wallet">
              <div className="hero-flow__wallet-title">Wallet balance</div>
              <div className="hero-flow__wallet-balance">184.35 CELO</div>
              <div className="hero-flow__wallet-copy">0x91AC...B72c is connected and prepared for queued sends.</div>
            </div>

            <div className="hero-flow__status">
              <div className="hero-flow__status-badge">Pending while offline</div>
              <WifiOff size={16} />
            </div>

            <div className="hero-flow__route">
              <div className="hero-flow__route-node">
                <strong>Offline</strong>
                <span>Store payment locally</span>
              </div>
              <div className="hero-flow__route-arrow" aria-hidden="true" />
              <div className="hero-flow__route-node">
                <strong>Sent</strong>
                <span>Broadcast when online</span>
              </div>
            </div>

            <div className="hero-flow__footer">
              <div className="hero-flow__footer-item">
                <div className="hero-flow__footer-label">Security</div>
                <div className="hero-flow__footer-value">
                  <ShieldCheck size={16} className="hero-flow__footer-icon" />
                  Passkey-ready
                </div>
              </div>
              <div className="hero-flow__footer-item">
                <div className="hero-flow__footer-label">Experience</div>
                <div className="hero-flow__footer-value">
                  <Smartphone size={16} className="hero-flow__footer-icon" />
                  Mobile first
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Hero;
