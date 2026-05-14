/**
 * useAntiCheatAlarm
 * Membunyikan alarm menggunakan Web Audio API (tidak butuh file audio eksternal).
 *
 * Tipe bunyi:
 *  - 'warning' : 2x bunyi pendek + buzz (peringatan), semakin keras di pelanggaran berikutnya
 *  - 'locked'  : 3x bunyi panjang + buzz (sesi dikunci / dikumpulkan paksa)
 */
export function useAntiCheatAlarm() {
  const playAlarm = (type: 'warning' | 'locked', _violationCount = 1) => {
    // Semua browser modern support AudioContext
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    /**
     * Buat satu "nada" dengan:
     *  - oscillator (gelombang sinus/kotak)
     *  - gain (volume) fade in/out
     * @param freq     frekuensi Hz
     * @param startAt  waktu mulai (detik, relatif ke ctx.currentTime)
     * @param duration durasi nada (detik)
     * @param volume   0..1
     * @param wave     'sine' | 'square'
     */
    const beep = (
      freq: number,
      startAt: number,
      duration: number,
      volume: number,
      wave: OscillatorType = 'sine',
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = wave;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);

      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startAt + 0.01);
      gain.gain.setValueAtTime(volume, ctx.currentTime + startAt + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration);

      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    };

    if (type === 'warning') {
      /**
       * Pola: 2x bunyi pendek naik nada + 1x buzz kotak
       * Browser tidak bisa mengubah volume hardware HP; gain dibuat maksimum sejak pelanggaran pertama.
       */
      const vol = 1;

      // Bunyi 1: 880 Hz (A5), 0.18 detik
      beep(880, 0.0, 0.18, vol);
      // Bunyi 2: 1100 Hz (C#6), 0.18 detik
      beep(1100, 0.25, 0.18, vol);
      // Buzz: 200 Hz gelombang kotak, 0.25 detik
      beep(200, 0.5, 0.25, vol * 0.6, 'square');

      // Tutup konteks setelah selesai (~ 0.85 detik)
      setTimeout(() => ctx.close(), 900);
    } else {
      /**
       * Pola: 3x bunyi panjang + buzz panjang (tanda kunci/kumpul paksa)
       */
      const vol = 1;

      beep(440,  0.0,  0.4, vol);          // A4
      beep(440,  0.5,  0.4, vol);          // A4
      beep(440,  1.0,  0.4, vol);          // A4
      beep(220,  1.5,  0.8, vol, 'square'); // buzz panjang A3

      // Tutup konteks setelah selesai (~ 2.4 detik)
      setTimeout(() => ctx.close(), 2500);
    }
  };

  return { playAlarm };
}
