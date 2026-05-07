import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import ShareHandler from "@/pages/ShareHandler";
import { ThemeProvider } from "@/components/theme-provider";
import { PassphraseProvider } from "@/contexts/passphrase-context";
import { PassphraseGate } from "@/components/passphrase-gate";

import { setBaseUrl } from "@workspace/api-client-react";

const queryClient = new QueryClient();

// Initialize API base URL from environment variable
const apiUrl = import.meta.env.VITE_API_URL || "";
console.log("[App] Initializing with API URL:", apiUrl || "(relative)");
setBaseUrl(apiUrl);

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/share" component={ShareHandler} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <PassphraseProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <PassphraseGate>
                <Router />
              </PassphraseGate>
            </WouterRouter>
          </PassphraseProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
