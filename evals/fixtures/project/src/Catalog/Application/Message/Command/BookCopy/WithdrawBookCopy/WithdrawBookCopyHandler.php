<?php

declare(strict_types=1);

namespace Catalog\Application\Message\Command\BookCopy\WithdrawBookCopy;

use Catalog\Domain\Event\BookCopyWithdrawn;
use Catalog\Domain\Model\BookCopy;
use Catalog\Domain\Repository\BookCopyRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsMessageHandler(bus: 'command.bus')]
readonly class WithdrawBookCopyHandler
{
    public function __construct(
        private BookCopyRepositoryInterface $bookCopyRepository,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(WithdrawBookCopy $command): BookCopy
    {
        $bookCopy = $command->bookCopy;
        $bookCopy->withdraw();

        $this->bookCopyRepository->save($bookCopy);

        $bookCopyId = $bookCopy->getId();
        \assert(null !== $bookCopyId);

        $this->eventBus->dispatch(new BookCopyWithdrawn($bookCopyId));

        return $bookCopy;
    }
}
