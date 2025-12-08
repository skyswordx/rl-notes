import torch
import torch.nn as nn
from stable_baselines3 import PPO
import argparse
import os
import shutil

class OnnxablePolicy(nn.Module):
    def __init__(self, extractor, action_net, value_net):
        super().__init__()
        self.extractor = extractor
        self.action_net = action_net
        self.value_net = value_net

    def forward(self, observation):
        # NOTE: You may need to preprocess the observation if using a CNN
        # Wrapper to forward pass through the policy
        features = self.extractor(observation)
        action = self.action_net(features)
        return action

def export_onnx(model_path, output_path, copy_to_public=True):
    print(f"Loading model from {model_path}...")
    model = PPO.load(model_path, device="cpu")
    
    # Create the ONNX-able policy wrapper
    onnx_policy = OnnxablePolicy(
        model.policy.mlp_extractor,
        model.policy.action_net,
        model.policy.value_net
    )
    
    # Create a dummy observation
    # PandaReach: Box(-10.0, 10.0, (18,), float32)
    # 18 dims = joint pos (7) + joint vel (7) + achieved_goal (3) + desired_goal (3) ?
    # Check enviroment to be sure, or just inspect observation_space
    # Standard PandaReach-v3 typically has 6-9 dims if just joints + target?
    # Let's trust the model's observation space
    
    observation_size = model.observation_space.shape
    dummy_input = torch.randn(1, *observation_size)
    
    print(f"Exporting to {output_path} with input shape {dummy_input.shape}...")
    
    torch.onnx.export(
        onnx_policy,
        dummy_input,
        output_path,
        opset_version=11,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}}
    )
    print("Export successful.")

    if copy_to_public:
        public_dest = "../../public/models/robot_policy.onnx"
        # Ensure directory exists
        os.makedirs(os.path.dirname(public_dest), exist_ok=True)
        print(f"Copying to {public_dest}...")
        shutil.copy(output_path, public_dest)
        print("Copy finished.")

if __name__ == "__main__":
    # Default paths
    default_model = "models/ppo_panda_reach_final.zip"
    default_output = "models/robot_policy.onnx"
    
    export_onnx(default_model, default_output)
