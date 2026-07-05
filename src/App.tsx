import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { PlaybackProvider } from "@/context/PlaybackContext";
import BasinSelectionPage from "@/pages/BasinSelectionPage";
import PlaybackPage from "@/pages/PlaybackPage";
// import CrossSectionPage from "@/pages/CrossSectionPage"; // HIDDEN – uncomment to restore
import RiverPlaybackPage from "@/pages/RiverPlaybackPage";
import CarbonPage from "@/pages/CarbonPage";
import SubBasinPage from "@/pages/SubBasinPage";
import RealMapViewport from "@/components/RealMapViewport"; // SPIKE — real basemap prototype

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlaybackProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
          <Routes>
            <Route path="/" element={<BasinSelectionPage />} />
            <Route path="/sub-basin" element={<SubBasinPage />} />
            <Route path="/playback" element={<PlaybackPage />} />
            {/* <Route path="/cross-section" element={<CrossSectionPage />} /> */}{/* HIDDEN – uncomment to restore */}
            <Route path="/river" element={<RiverPlaybackPage />} />
            <Route path="/carbon" element={<CarbonPage />} />
            <Route path="/map-real" element={<RealMapViewport />} /> {/* SPIKE — real basemap prototype */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </PlaybackProvider>
    </QueryClientProvider>
  );
}
