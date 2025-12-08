import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    base: '/rl-notes/', // github 仓库名称
    srcExclude: ['reference/**'],
    markdown: {
        math: true
    },
    title: "RoboLearning",
    description: "深入浅出强化学习，结合数学推导与交互式可视化",
    head: [['link', { rel: 'icon', href: '/rl-hero-simple.png' }]],
    themeConfig: {
        logo: '/rl-hero-simple.png',
        siteTitle: 'RoboLearning',

        nav: [
            { text: '首页', link: '/' },
            {
                text: '课程笔记',
                items: [
                    { text: '第零章-宏观架构', link: '/my_rl_notes/强化学习-第零章-宏观架构' },
                    { text: '第一章-基本概念', link: '/my_rl_notes/强化学习-第一章-基本概念' },
                    { text: '第二章-状态值与贝尔曼方程', link: '/my_rl_notes/强化学习-第二章-状态值与贝尔曼方程' }
                ]
            }
        ],

        sidebar: {
            '/my_rl_notes/': [
                {
                    text: '强化学习课程',
                    items: [
                        { text: '第零章-宏观架构', link: '/my_rl_notes/强化学习-第零章-宏观架构' },
                        { text: '第一章-基本概念', link: '/my_rl_notes/强化学习-第一章-基本概念' },
                        { text: '第二章-状态值与贝尔曼方程', link: '/my_rl_notes/强化学习-第二章-状态值与贝尔曼方程' }
                    ]
                }
            ]
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/skyswordx' }
        ],

        search: {
            provider: 'local',
            options: {
                translations: {
                    button: {
                        buttonText: '搜索文档',
                        buttonAriaLabel: '搜索文档'
                    },
                    modal: {
                        noResultsText: '无法找到相关结果',
                        resetButtonTitle: '清除查询条件',
                        footer: {
                            selectText: '选择',
                            navigateText: '切换'
                        }
                    }
                }
            }
        },

        footer: {
            message: '基于 MIT 许可发布',
            copyright: '版权所有 © 2025 circlemoon /RoboLearning'
        },

        outline: {
            level: [2, 3],
            label: '本页目录'
        },

        docFooter: {
            prev: '上一页',
            next: '下一页'
        },

        lastUpdated: {
            text: '最后更新于',
            formatOptions: {
                dateStyle: 'short',
                timeStyle: 'short'
            }
        }
    }
})
