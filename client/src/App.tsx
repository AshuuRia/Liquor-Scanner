import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LiquorConverter from "@/pages/liquor-converter";
import BarcodeScannerPage from "@/pages/barcode-scanner-page";
import PriceComparePage from "@/pages/price-compare-page";

function Router() {
  return (
    <Switch>
      <Route path="/" component={LiquorConverter} />
      <Route path="/scanner" component={BarcodeScannerPage} />
      <Route path="/price-compare" component={PriceComparePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
