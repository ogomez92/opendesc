export interface Subtitle {
  id: number;
  startTime: number; // ms
  endTime: number; // ms
  text: string;
}

export function parseSrt(content: string): Subtitle[] {
  const subs: Subtitle[] = [];
  // Normalize line endings and split by double newline
  const normalized = content.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split('\n\n');
  
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue; // Need at least timestamp and text (ID might be skipped in malformed srt)
    
    let idIdx = 0;
    // Check if first line is ID (number)
    if (/^\d+$/.test(lines[0]) && lines[1].includes('-->')) {
      idIdx = 0;
    } else if (lines[0].includes('-->')) {
      // Missing ID?
      idIdx = -1;
    }
    
    const id = idIdx >= 0 ? parseInt(lines[idIdx], 10) : subs.length + 1;
    const timeLine = idIdx >= 0 ? lines[idIdx + 1] : lines[0];
    const textLines = lines.slice(idIdx + 2);
    const text = textLines.join('\n');
    
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split(' --> ');
    if (!startStr || !endStr) continue;
    
    const startTime = parseTime(startStr.trim());
    const endTime = parseTime(endStr.trim());
    
    subs.push({ id, startTime, endTime, text });
  }
  
  return subs;
}

function parseTime(timeStr: string): number {
  // Normalize decimal separator to dot
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  
  // Handle HH:MM:SS.mmm
  const seconds = parseFloat(parts.pop() || '0');
  const minutes = parseInt(parts.pop() || '0', 10);
  const hours = parseInt(parts.pop() || '0', 10);
  
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export function formatTimestamp(ms: number): string {
  const totalMs = Math.max(0, ms);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;

  const pad = (value: number, size: number) => value.toString().padStart(size, '0');
  // Ensure millis is formatted to 3 decimal places if it's a float, or just 3 digits if int
  // SRT standard is 3 digits. We use toFixed(0) to standard integer ms for display/save compliance
  // unless we want to support non-standard high precision SRT. 
  // Given the user request "no rounding", let's try to keep it precise but valid string.
  // Actually, standard SRT is integer milliseconds. 
  // We will use toFixed(0) for the string representation to comply with standard, 
  // but internally we kept the float in parseTime. 
  // Wait, "no rounding". toFixed(0) rounds. 
  // Let's use Math.floor for the integer part of millis.
  
  const millisInt = Math.floor(millis);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millisInt, 3)}`;
}

export function serializeSrt(subtitles: Subtitle[]): string {
  const ordered = [...subtitles]
    .sort((a, b) => a.startTime - b.startTime || a.id - b.id)
    .map((sub, index) => ({
      ...sub,
      id: index + 1,
    }));

  return ordered
    .map((sub) => {
      const start = formatTimestamp(sub.startTime);
      const end = formatTimestamp(sub.endTime);
      return `${sub.id}\n${start} --> ${end}\n${sub.text.trim()}\n`;
    })
    .join('\n')
    .trim() + '\n';
}
