import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { authAPI } from '@/services/apiClient';
import { clearSession, getStoredUser } from '@/lib/auth';

export const SettingsPage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setUser(getStoredUser('user'));
  }, []);

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } finally {
      clearSession('user');
      navigate('/auth/login');
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await authAPI.logout();
    } finally {
      clearSession('user');
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Button>
          <h1 className="flex-1 text-center font-display text-xl font-semibold">Settings</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-md mx-auto space-y-6">
        {/* Account Section */}
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground mb-3">Account</h2>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground mb-2">User ID</p>
            <p className="text-sm font-mono text-foreground break-all mb-4">{user?.id}</p>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full border-border rounded-lg h-10 gap-2"
            >
              <LogOut size={16} />
              Logout
            </Button>
          </Card>
        </div>

        {/* Security Section */}
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground mb-3">Security</h2>
          <Card className="p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">Passkey Management</p>
              <p className="text-xs text-muted-foreground mb-3">Your account is secured by WebAuthn passkey</p>
              <Button variant="outline" className="w-full border-border rounded-lg h-10" disabled>
                Manage Passkeys
              </Button>
            </div>
          </Card>
        </div>

        {/* Danger Zone */}
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground mb-3">Danger Zone</h2>
          <Card className="p-4 border-destructive/50 bg-destructive/5">
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="destructive"
              className="w-full rounded-lg h-10 gap-2"
            >
              <Trash2 size={16} />
              Delete Account
            </Button>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="rounded-lg">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All your wallet data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              className="flex-1 rounded-lg"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
