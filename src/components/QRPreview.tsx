import { useEffect, useState } from "react";

export default function QRPreview({ value, size = 112 }: { value: string; size?: number }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImage("");
    setFailed(false);
    if (!value.trim()) return () => { active = false; };
    const generate = async () => {
      const { default: QRCode } = await import("qrcode");
      const data = await QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark: "#174ea6", light: "#ffffff" } });
      if (active) setImage(data);
    };
    void generate().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [value, size]);

  if (failed) return <span className="qr-preview-fallback" style={{ width: size, height: size }}>QR unavailable</span>;
  if (!image) return <span className="qr-preview-loading" style={{ width: size, height: size }}><i /></span>;
  return <img className="qr-preview-image" src={image} width={size} height={size} alt="Scannable QR code" />;
}
