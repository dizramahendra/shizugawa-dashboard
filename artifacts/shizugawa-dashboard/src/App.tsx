import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import BasinSelectionPage from "@/pages/BasinSelectionPage";
import PlaybackPage from "@/pages/PlaybackPage";
import RiverPlaybackPage from "@/pages/RiverPlaybackPage";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
        <Routes>
          <Route path="/" element={<BasinSelectionPage />} />
          <Route path="/river" element={<RiverPlaybackPage />} />
          <Route path="/playback" element={<PlaybackPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
