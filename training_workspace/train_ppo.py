import gymnasium as gym
import panda_gym
from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.callbacks import CheckpointCallback
import os

def train():
    # Create log dir
    log_dir = "./logs/"
    models_dir = "./models/"
    os.makedirs(log_dir, exist_ok=True)
    os.makedirs(models_dir, exist_ok=True)

    # 1. Create environment
    # PandaReach-v3: Robot needs to move end-effector to a target position
    env_id = "PandaReach-v3"
    
    # Vectorized environment for faster training
    env = make_vec_env(env_id, n_envs=4)

    # 2. Define the model
    # MlpPolicy is sufficient for state-based observations
    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        tensorboard_log=log_dir,
        learning_rate=3e-4,
        batch_size=64,
        n_steps=2048,
    )

    # 3. Train
    print(f"Starting training on {env_id}...")
    checkpoint_callback = CheckpointCallback(
        save_freq=10000,
        save_path=models_dir,
        name_prefix="ppo_panda_reach"
    )
    
    # Train for 100k steps (usually enough for Reach task)
    total_timesteps = 100_000
    model.learn(total_timesteps=total_timesteps, callback=checkpoint_callback)

    # 4. Save final model
    model.save(f"{models_dir}/ppo_panda_reach_final")
    print("Training finished. Model saved.")

    # 5. Evaluate (Quick check)
    env_eval = gym.make(env_id)
    obs, _ = env_eval.reset()
    print("Running evaluation loop...")
    for _ in range(100):
        action, _states = model.predict(obs)
        obs, rewards, dones, truncated, info = env_eval.step(action)
        if dones or truncated:
            obs, _ = env_eval.reset()
    
    env_eval.close()

if __name__ == "__main__":
    train()
