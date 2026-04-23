import { motion } from "framer-motion";
import { ArrowRight, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const CTASection = () => {
  const navigate = useNavigate();
  
  return (
    <section id="contact" className="section-padding bg-muted/50">
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="hero-dark rounded-3xl p-8 sm:p-12 lg:p-16 text-center relative overflow-hidden"
        >
          <div className="absolute inset-0">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/10 blur-3xl" />
          </div>

          <div className="relative z-10 max-w-2xl mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-6">
              <Fingerprint size={32} className="text-primary" />
            </div>

            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-secondary-foreground mb-4">
              Ready to Go <span className="gradient-text">Offline</span>?
            </h2>
            <p className="text-secondary-foreground/60 text-lg mb-8 max-w-lg mx-auto">
              Create your wallet in seconds with Passkey authentication. No passwords, no seed phrases — just tap and go.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white hover:from-indigo-600 hover:to-blue-600 font-semibold text-base px-8 h-12 rounded-lg shadow-lg transition transform hover:scale-105 gap-2"
                onClick={() => navigate('/auth/login')}
              >
                Create Wallet with Passkey <ArrowRight size={18} />
              </Button>
              <Button
                size="lg"
                className="border-2 border-indigo-500 text-indigo-500 hover:bg-indigo-500 hover:text-white font-semibold text-base px-8 h-12 rounded-lg transition"
                onClick={() => navigate('/auth/login')}
              >
                Login
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
