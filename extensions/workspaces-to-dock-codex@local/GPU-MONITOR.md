GPU monitor
===========

Click GPU: Auto above the GPU readings to select Auto, AMD or NVIDIA.
The selection is saved in $XDG_CONFIG_HOME/codex-gpu-monitor (normally ~/.config).
This controls telemetry only, not application routing or drivers.
Auto prefers an AMD device driven by amdgpu, otherwise a detected NVIDIA GPU.
AMD uses DRM/sysfs; NVIDIA uses nvidia-smi with a four-second timeout.
Python 3 is required. No third-party Python dependencies.
Missing readings are unavailable, never fabricated zeroes. AMD PPT is labeled APU power.
The first supported GPU for the selected vendor is used; per-device selection is not yet implemented.
