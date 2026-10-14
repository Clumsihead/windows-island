import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";

export default function Wallpaper({ flash }: { flash: (m: string) => void }) {
  const [current, setCurrent] = useState("");

  const choose = async () => {
    // The file dialog steals focus and the cursor leaves the island: keep it open meanwhile.
    await api.setPinned(true);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "bmp"] }],
      });
      if (typeof picked === "string") {
        await api.setWallpaper(picked);
        setCurrent(picked);
        flash("Wallpaper changed");
      }
    } catch (e) {
      flash(String(e));
    } finally {
      await api.setPinned(false);
    }
  };

  return (
    <div className="page">
      <div className="page-heading"><div><h2>Wallpaper</h2><p>Set any local image as your desktop background.</p></div></div>
      <div className="card">
        <div className="card-title"><ImageIcon size={15} /> Choose an image</div>
        <button className="gold-button" onClick={choose}>Browse…</button>
        {current && <small className="path">{current}</small>}
      </div>
    </div>
  );
}
