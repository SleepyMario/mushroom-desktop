#!/usr/bin/env python3
"""Read AMD or NVIDIA sensors; automatic selection never forces a driver."""
import argparse
import csv
import os
import subprocess
import json
import time
from datetime import datetime
from pathlib import Path


def read_number(path, divisor=1):
    try:
        return float(path.read_text().strip()) / divisor
    except (OSError, ValueError):
        return None


def collect_amd(root=Path('/sys/class/drm')):
    for card in sorted(root.glob('card[0-9]*')):
        if '-' in card.name:
            continue
        device = card / 'device'
        try:
            if (device / 'vendor').read_text().strip() != '0x1002':
                continue
            if (device / 'driver').resolve().name != 'amdgpu':
                continue
        except OSError:
            continue
        sensor = next((p for p in sorted((device / 'hwmon').glob('hwmon*'))
                       if (p / 'name').read_text().strip() == 'amdgpu'), None)
        power = None
        power_label = 'Power'
        temperature = None
        if sensor:
            temperature = read_number(sensor / 'temp1_input', 1000)
            power = read_number(sensor / 'power1_average', 1_000_000)
            if power is None:
                power = read_number(sensor / 'power1_input', 1_000_000)
            try:
                if (sensor / 'power1_label').read_text().strip() == 'PPT':
                    power_label = 'APU power'
            except OSError:
                pass
        return dict(name='AMD GPU', gpu=read_number(device / 'gpu_busy_percent'),
                    used=read_number(device / 'mem_info_vram_used', 1048576),
                    total=read_number(device / 'mem_info_vram_total', 1048576),
                    temperature=temperature, power=power, power_label=power_label,
                    encoder=None)
    raise RuntimeError('No AMD GPU using amdgpu found')


def collect_nvidia():
    fields = 'name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,utilization.encoder'
    result = subprocess.run(['nvidia-smi', '--query-gpu=' + fields,
                             '--format=csv,noheader,nounits'],
                            check=True, capture_output=True, text=True, timeout=4)
    rows = list(csv.reader(result.stdout.splitlines()))
    if not rows or len(rows[0]) != 7:
        raise RuntimeError('Invalid NVIDIA sensor response')
    name, gpu, temperature, used, total, power, encoder = rows[0]
    def number(text):
        try: return float(text.strip())
        except ValueError: return None
    return dict(name=name.strip(), vendor='nvidia', gpu=number(gpu),
                temperature=number(temperature), used=number(used), total=number(total),
                power=number(power), power_label='GPU power', encoder=number(encoder))


def preferred_vendor():
    try:
        setting = (Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) /
                   'codex-gpu-monitor').read_text().strip()
        return setting if setting in ('auto', 'amd', 'nvidia') else 'auto'
    except OSError:
        return 'auto'


def collect(vendor='auto', root=Path('/sys/class/drm')):
    if vendor in ('auto', 'amd'):
        try:
            result = collect_amd(root)
            result['vendor'] = 'amd'
            return result
        except RuntimeError:
            if vendor == 'amd': raise
    # Do not probe NVIDIA utilities on systems without an NVIDIA PCI device.
    for device in Path('/sys/bus/pci/devices').glob('*'):
        try:
            if ((device / 'vendor').read_text().strip() == '0x10de' and
                    (device / 'class').read_text().strip().startswith('0x03')):
                return collect_nvidia()
        except OSError:
            continue
    raise RuntimeError('Selected GPU is unavailable')


def value(n, unit=''):
    return '—' if n is None else f'{n:.0f}{unit}'


def labels(sample):
    return dict(gpu=f"{sample['vendor'].upper()} {value(sample['gpu'], '%')} · {value(sample['temperature'], '°C')}",
                vram=f"VRAM {value(sample['used'])} / {value(sample['total'])} M",
                power=f"{sample['power_label']} {value(sample['power'], ' W')}",
                encoder=f"ENC {value(sample['encoder'], '%')}")


def waybar(sample, pressure=0):
    reasons = []
    state = 'normal'
    if sample['temperature'] is not None and sample['temperature'] >= 90:
        reasons.append('GPU temperature at least 90°C')
        state = 'critical'
    elif sample['temperature'] is not None and sample['temperature'] >= 82:
        reasons.append('GPU temperature at least 82°C')
        state = 'warning'
    if pressure >= 3:
        reasons.append('GPU has remained saturated')
        if state == 'normal':
            state = 'warning'
    # An APU can use shared system memory; reserved VRAM occupancy alone is not
    # evidence that all usable GPU memory is exhausted.
    text = '   '.join(labels(sample).values())
    tooltip = sample['name'] + '\n' + text
    if sample['encoder'] is None:
        tooltip += '\nEncoder usage is unavailable.'
    if sample['vendor'] == 'amd':
        tooltip += '\nAPU VRAM is the reserved aperture, not all shared memory.'
    tooltip += '\n' + ('; '.join(reasons) or 'No sustained GPU load or temperature warning')
    return dict(text=text, tooltip=tooltip, **{'class':state})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--vendor', choices=['auto', 'amd', 'nvidia'])
    parser.add_argument('--waybar', action='store_true')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    previous = None
    pressure = 0
    while True:
        try:
            sample = collect(args.vendor or preferred_vendor())
            pressure = pressure + 1 if (sample['gpu'] or 0) >= 95 else 0
            output = waybar(sample, pressure) if args.waybar else dict(labels(sample), vendor=sample['vendor'])
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            pressure = 0
            output = (dict(text='GPU unavailable', tooltip=str(error), **{'class':'error'})
                      if args.waybar else dict(vendor=args.vendor or preferred_vendor(), gpu=f'{(args.vendor or preferred_vendor()).upper()} GPU unavailable', vram='VRAM —', power='Power —', encoder='ENC —'))
        if args.watch and args.waybar:
            state = output['class']
            if state != previous and (previous is not None or state != 'normal'):
                log = Path.home() / '.local/state/gpu-watch/events.log'
                try:
                    log.parent.mkdir(parents=True, exist_ok=True)
                    if log.exists() and log.stat().st_size > 1_000_000:
                        log.replace(log.with_suffix('.log.1'))
                    with log.open('a') as stream:
                        stream.write(f'{datetime.now().astimezone().isoformat()} {state.upper()} {output["text"]}\n')
                except OSError:
                    pass
            previous = state
        print(json.dumps(output), flush=True)
        if not args.watch:
            break
        time.sleep(2)


if __name__ == '__main__':
    main()
