"""Re-quantize Klang's fp32 Pianissimo encoder to symmetric 4-bit MatMulNBits.

Both published 4-bit builds (KlangAI int4, s0undy q4) use asymmetric
quantization with zero points, which ONNX Runtime Web 1.24's WebGPU
MatMulNBits kernel rejects ("zeroPoints input size error"). Symmetric
quantization has no zero-point input, so the kernel accepts it.

    pip install onnx onnxruntime onnx_ir
    python scripts/quantize-pianissimo-encoder.py <fp32-dir> <out.onnx> [block_size]

<fp32-dir> holds encoder-model.onnx + encoder-model.onnx.data from
KlangAI/pianissimo-sv-onnx (CC BY 4.0).
"""
import sys
from pathlib import Path

import onnx
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

src, out = Path(sys.argv[1]) / "encoder-model.onnx", Path(sys.argv[2])
block_size = int(sys.argv[3]) if len(sys.argv) > 3 else 32

model = onnx.load(str(src))  # pulls in encoder-model.onnx.data
quant = MatMulNBitsQuantizer(model, block_size=block_size, is_symmetric=True)
quant.process()
onnx.save(quant.model.model, str(out))

nb = [n for n in quant.model.model.graph.node if n.op_type == "MatMulNBits"]
print(f"{len(nb)} MatMulNBits nodes, inputs per node: {len(nb[0].input)}; "
      f"{out.stat().st_size / 1e6:.0f} MB -> {out}")
